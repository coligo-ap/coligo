"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMerchantId } from "@/lib/auth/merchant";
import {
  isValidTransition,
  ORDER_STATUS_META,
  type OrderStatus,
} from "@/lib/types";
import {
  notifyCustomerStatusChange,
  notifyDriversNewExpress,
  notifyOfflineDriversExpressTeaser,
  notifyDriverOrderCancelled,
} from "@/lib/fcm/triggers";

export type OrderActionResult = {
  error?: string;
  success?: string;
  /**
   * `true` quand l'erreur vient d'un board PÉRIMÉ : la commande n'est plus dans
   * l'état attendu (auto-refusée après 15 min, ou déjà avancée par un autre
   * écran). Le client doit alors re-synchroniser l'affichage (router.refresh /
   * passage à la commande suivante) plutôt que de laisser une carte morte.
   */
  stale?: boolean;
};

/**
 * Fait avancer une commande dans son cycle de vie.
 *
 * - Vérifie que la transition est autorisée (sinon refus).
 * - La RLS garantit que la commande appartient au commerçant connecté.
 * - Idempotency : si un `clientOperationId` déjà traité est rejoué, on ne
 *   réapplique pas (la même opération ne produit qu'un seul changement).
 * - Audit : écrit une ligne dans `order_events` à chaque changement.
 */
export async function updateOrderStatus(
  orderId: string,
  to: OrderStatus,
  clientOperationId?: string,
  note?: string | null
): Promise<OrderActionResult> {
  const supabase = await createClient();

  // Idempotency : opération déjà appliquée ?
  if (clientOperationId) {
    const { data: existing } = await supabase
      .from("order_events")
      .select("id")
      .eq("client_operation_id", clientOperationId)
      .maybeSingle();
    if (existing) return { success: "Déjà appliqué." };
  }

  // RLS : ne renvoie la commande que si elle appartient au commerçant.
  const { data: order, error: readError } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .maybeSingle();

  if (readError) return { error: `Erreur : ${readError.message}` };
  if (!order) return { error: "Commande introuvable." };

  const from = order.status as OrderStatus;
  if (from === to) return { success: "Aucun changement." };
  if (!isValidTransition(from, to)) {
    // Message clair (pas de jargon « cancelled → preparing ») : le plus souvent
    // le board est PÉRIMÉ — la commande a été auto-refusée (non acceptée sous
    // 15 min) ou avancée ailleurs entre l'affichage et le clic.
    const label = ORDER_STATUS_META[from]?.label ?? from;
    const message =
      from === "cancelled"
        ? "Cette commande a déjà été annulée (refus, ou non acceptée sous 15 min). La liste va se rafraîchir."
        : from === "completed"
          ? "Cette commande est déjà terminée. La liste va se rafraîchir."
          : `Action impossible : la commande est déjà « ${label} ». La liste va se rafraîchir.`;
    return { error: message, stale: true };
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({ status: to })
    .eq("id", orderId);

  if (updateError) {
    return { error: `Erreur lors de la mise à jour : ${updateError.message}` };
  }

  // Audit (append-only). Une erreur ici ne doit pas casser l'action.
  // `note` sert notamment à tracer le MOTIF d'un refus (rupture, surcharge…).
  await supabase.from("order_events").insert({
    order_id: orderId,
    from_status: from,
    to_status: to,
    client_operation_id: clientOperationId ?? null,
    note: note?.slice(0, 200) ?? null,
  });

  // Push FCM au client si le nouveau statut est significatif (preparing /
  // ready / completed / cancelled). Fire-and-forget — pas de blocage.
  void notifyCustomerStatusChange({ orderId, newStatus: to });

  // Express : on alerte les livreurs DÈS le DÉBUT de la préparation (la course
  // est sur le réseau immédiatement — mig 0129 — le livreur peut foncer pendant
  // que le plat se prépare). On ré-alerte à « prête » au cas où personne n'a
  // encore pris la course. Le helper revérifie mode/attribution (no-op sinon).
  if (to === "preparing" || to === "ready") {
    // Livreurs EN LIGNE proches : push par course. Livreurs HORS LIGNE proches :
    // teaser agrégé throttlé (« mets-toi en ligne… »). Les deux sont no-op si
    // la commande n'est pas une express non attribuée.
    void notifyDriversNewExpress({ orderId });
    void notifyOfflineDriversExpressTeaser({ orderId });
  }

  revalidatePath("/dashboard");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { success: "Commande mise à jour." };
}

/**
 * Annulation commerçant DURCIE (mig 0117) — appel de confirmation client.
 *
 * Passe par la RPC `merchant_cancel_order` (SECURITY DEFINER) qui :
 *  - vérifie la propriété de la commande,
 *  - REFUSE si le livreur a déjà récupéré la commande (already_picked_up),
 *  - libère le livreur express + rembourse un éventuel paiement en ligne,
 *  - trace le motif (par défaut « Client injoignable »).
 * À utiliser pour TOUTE annulation commerçant (refus pending inclus) à la place
 * d'un simple updateOrderStatus → 'cancelled'.
 */
export async function cancelOrderByMerchant(
  orderId: string,
  reason?: string
): Promise<OrderActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "merchant_cancel_order" as never,
    {
      p_order_id: orderId,
      p_reason: reason ?? null,
    } as never
  );
  if (error) return { error: `Erreur : ${error.message}` };
  const res = data as { ok: boolean; reason?: string } | null;
  if (!res?.ok) {
    const map: Record<string, { msg: string; stale?: boolean }> = {
      already_picked_up: {
        msg: "Impossible d'annuler : le livreur a déjà récupéré la commande. Contacte le support (super-admin) si besoin.",
        stale: true,
      },
      already_terminal: {
        msg: "Cette commande est déjà terminée ou annulée. La liste va se rafraîchir.",
        stale: true,
      },
      forbidden: { msg: "Action non autorisée." },
      order_not_found: { msg: "Commande introuvable.", stale: true },
    };
    const e = map[res?.reason ?? ""] ?? { msg: "Annulation impossible." };
    return { error: e.msg, stale: e.stale };
  }

  void notifyCustomerStatusChange({ orderId, newStatus: "cancelled" });
  // Stoppe le livreur s'il avait accepté la course (push instantané ; le pop-up
  // + arrêt en temps réel sont gérés par DriverCancelWatch côté app livreur).
  void notifyDriverOrderCancelled({ orderId });
  revalidatePath("/dashboard");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { success: "Commande annulée." };
}

/**
 * Résultat de la validation de retrait — en plus du succès/erreur, deux
 * signaux STRUCTURÉS pour piloter l'UI (jamais du parsing de message) :
 *  - `needsReady` : commande identifiée mais pas encore marquée « prête » →
 *    l'UI propose « Marquer prête » ou « Marquer prête + retrait » (renvoyer
 *    l'appel avec `confirmReady: true` enchaîne les transitions).
 *  - `needsClientCode` : commande PAYÉE EN LIGNE scannée via le QR du ticket →
 *    on exige le code/QR du CLIENT (preuve de remise : l'argent est déjà
 *    encaissé, remettre le sac sans preuve = risque de litige).
 */
export type PickupValidationResult = OrderActionResult & {
  orderId?: string;
  needsReady?: {
    orderId: string;
    orderNumber: string | null;
    customerName: string;
    statusLabel: string;
  };
  needsClientCode?: boolean;
};

/**
 * Valide un retrait et passe la commande (du commerçant connecté, RLS) en
 * « récupérée ». Deux identifiants acceptés :
 *
 *  - le CODE PIN 4-6 chiffres montré par le CLIENT (QR in-app / oral) —
 *    preuve de présence du client, OBLIGATOIRE pour le payé en ligne ;
 *  - la RÉFÉRENCE publique de commande (ex. « A042 ») — QR imprimé sur le
 *    ticket : scan du sac au comptoir, façon Uber Eats. Réservée aux
 *    commandes payées au comptoir (cash).
 *
 * Logique métier :
 *  - livraison (express/tournée) → JAMAIS validée ici (le livreur confirme) ;
 *  - `ready` → completed (chemin nominal) ;
 *  - `pending/accepted/preparing` → signal `needsReady` ; avec
 *    `confirmReady: true`, on enchaîne les transitions réelles jusqu'à
 *    completed (chaque étape auditée dans order_events, comme si le
 *    commerçant avait fait « prête » puis « retrait ») ;
 *  - annulée / déjà récupérée → erreurs explicites.
 */
export async function validatePickupCode(
  code: string,
  clientOperationId?: string,
  opts?: { confirmReady?: boolean }
): Promise<PickupValidationResult> {
  const raw = (code ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  // PIN à 4 chiffres (commandes récentes) ; on tolère 6 pour d'éventuelles
  // commandes legacy non encore régénérées.
  const isPin =
    /^[\s\d]*$/.test(raw) && digits.length >= 4 && digits.length <= 6;
  // Référence publique de ticket : « A042 » (# toléré, insensible à la casse).
  const ref = raw.replace(/^#/, "").toUpperCase();
  const isRef = !isPin && /^[A-Z0-9]{2,8}$/.test(ref);
  if (!isPin && !isRef) {
    return { error: "Code ou référence non reconnu." };
  }
  const normalized = digits;

  const supabase = await createClient();

  // Idempotency PRIORITAIRE : si on a déjà appliqué ce client_operation_id,
  // on renvoie un succès SANS re-vérifier le statut. Sans ça, un retry après
  // une coupure réseau (action appliquée côté serveur mais réponse perdue)
  // tomberait sur le check `status === "completed"` et renverrait l'erreur
  // « déjà été récupérée » à un commerçant qui croit (à raison) avoir réussi.
  if (clientOperationId) {
    const { data: existing } = await supabase
      .from("order_events")
      .select("order_id")
      .eq("client_operation_id", clientOperationId)
      .maybeSingle();
    if (existing) {
      return {
        success: "Déjà appliqué.",
        orderId: existing.order_id,
      };
    }
  }

  type FoundOrder = {
    id: string;
    status: string;
    customer_name: string;
    fulfillment_type: string | null;
    payment_method: string | null;
    order_number: string | null;
  };
  const FIELDS =
    "id, status, customer_name, fulfillment_type, payment_method, order_number";
  let order: FoundOrder | null = null;

  // Scope commerçant EXPLICITE (règle maison : jamais la RLS seule) — un code
  // ou une référence d'un autre commerce ne doit jamais matcher ici.
  const merchantId = await getCurrentMerchantId();
  if (!merchantId) return { error: "Session expirée, reconnectez-vous." };

  if (isPin) {
    // Le PIN à 4 chiffres n'est PAS unique dans le temps : deux commandes du
    // même commerce peuvent partager un code (audit A5 — `maybeSingle()`
    // cassait le comptoir sur collision). On vise les commandes VIVANTES ;
    // 2+ vivantes = ambigu → on exige la référence du ticket.
    const { data: matches, error } = await supabase
      .from("orders")
      .select(`${FIELDS}, created_at`)
      .eq("merchant_id", merchantId)
      .eq("pickup_code", normalized)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) return { error: `Erreur : ${error.message}` };
    if (!matches || matches.length === 0) {
      return { error: "Aucune commande ne correspond à ce code." };
    }
    const alive = matches.filter(
      (o) => o.status !== "completed" && o.status !== "cancelled"
    );
    if (alive.length > 1) {
      return {
        error:
          "Code ambigu (plusieurs commandes en cours). Utilisez la référence du ticket (ex. A042).",
      };
    }
    // Aucune vivante → la plus récente porte le bon message (déjà récupérée /
    // annulée) via les gardes plus bas.
    order = alive[0] ?? matches[0];
  } else {
    // RÉFÉRENCE de ticket : order_number peut se répéter dans le temps (la
    // numérotation recommence) → on prend les plus récentes. On ne cible que
    // s'il y a EXACTEMENT une commande retrait non terminée pour la référence.
    const { data: matches, error } = await supabase
      .from("orders")
      .select(`${FIELDS}, created_at`)
      .eq("merchant_id", merchantId)
      .eq("order_number", ref)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) return { error: `Erreur : ${error.message}` };
    if (!matches || matches.length === 0) {
      return { error: "Aucune commande ne correspond à cette référence." };
    }
    const pickups = matches.filter((o) => o.fulfillment_type !== "delivery");
    if (pickups.length === 0) {
      return {
        error:
          "Commande en livraison : la remise est confirmée par le livreur, pas au comptoir.",
      };
    }
    // Cible = les commandes encore « en vie » (ni terminées ni annulées) ;
    // s'il y en a plusieurs pour la même référence (récurrence de numéro),
    // on refuse et on exige le code client (zéro ambiguïté sur l'argent).
    const alive = pickups.filter(
      (o) => o.status !== "completed" && o.status !== "cancelled"
    );
    if (alive.length > 1) {
      return {
        error:
          "Référence ambiguë (plusieurs commandes en cours). Utilisez le code du client.",
      };
    }
    order = alive[0] ?? pickups[0];
  }

  // ─── Gardes métier (ordre volontaire : du définitif au réparable) ─────────
  // 1. LIVRAISON (express OU tournée) : jamais validée au comptoir — le
  //    livreur récupère puis confirme la remise avec son propre code.
  if (order.fulfillment_type === "delivery") {
    return {
      error:
        "Commande en livraison : la remise est confirmée par le livreur, pas au comptoir.",
    };
  }
  // 2. États terminaux.
  if (order.status === "completed") {
    return { error: "Cette commande a déjà été récupérée." };
  }
  if (order.status === "cancelled") {
    return { error: "Cette commande a été annulée." };
  }
  // 3. PAYÉ EN LIGNE + scan du ticket : le ticket est dans les mains du
  //    commerçant, il ne prouve rien. L'argent étant déjà encaissé, on exige
  //    le code/QR du CLIENT comme preuve de remise. (Le PIN, lui, passe.)
  //    NB : la RLS ne montre au commerçant une commande online que déjà payée.
  if (isRef && order.payment_method === "online") {
    return {
      error:
        "Commande payée en ligne : demandez le QR (ou le code) du client — c'est la preuve de remise.",
      needsClientCode: true,
    };
  }
  // 4. PAS ENCORE PRÊTE (pending / accepted / preparing) : signal structuré →
  //    l'UI propose « Marquer prête » ou « Marquer prête + retrait ».
  if (order.status !== "ready" && !opts?.confirmReady) {
    return {
      error: "Cette commande n'est pas encore marquée « prête ».",
      needsReady: {
        orderId: order.id,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        statusLabel:
          ORDER_STATUS_META[order.status as OrderStatus]?.label ?? order.status,
      },
    };
  }

  // ─── Transitions réelles ───────────────────────────────────────────────────
  // confirmReady : on enchaîne les VRAIES transitions jusqu'à completed en
  // respectant ALLOWED_TRANSITIONS (chaque étape = une ligne d'audit
  // order_events + notifications client, exactement comme si le commerçant
  // avait cliqué « prête » puis « retrait »). Idempotence par étape via un
  // client_operation_id suffixé — un rejeu ne réapplique rien.
  const CHAIN: Partial<Record<OrderStatus, OrderStatus[]>> = {
    pending: ["preparing", "ready", "completed"],
    accepted: ["preparing", "ready", "completed"],
    preparing: ["ready", "completed"],
    ready: ["completed"],
  };
  const steps = CHAIN[order.status as OrderStatus];
  if (!steps) {
    return { error: "Cette commande n'est pas encore prête au retrait." };
  }
  for (const step of steps) {
    // L'étape FINALE (completed) porte le client_operation_id BRUT : un rejeu
    // après réponse perdue retombe ainsi sur le check d'idempotence global en
    // tête de fonction (succès immédiat, pas de « déjà récupérée » à tort).
    // Les étapes intermédiaires portent un id suffixé (idempotentes chacune).
    const stepOpId =
      step === "completed"
        ? clientOperationId
        : clientOperationId
          ? `${clientOperationId}:${step}`
          : undefined;
    const res = await updateOrderStatus(order.id, step, stepOpId);
    // « Déjà appliqué » (rejeu) n'est pas une erreur : on continue la chaîne.
    if (res.error) return { error: res.error, stale: res.stale };
  }

  return {
    success:
      steps.length > 1
        ? `Commande marquée prête et retrait validé pour ${order.customer_name}.`
        : `Retrait validé pour ${order.customer_name}.`,
    orderId: order.id,
  };
}
