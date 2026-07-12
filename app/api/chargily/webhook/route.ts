// =============================================================================
// Webhook Chargily Pay v2 — POST /api/chargily/webhook
// =============================================================================
// ⚠️ CRITIQUE — règles non négociables (cf. PARTIE A du prompt 18) :
//   1. Vérification de signature OBLIGATOIRE (HMAC-SHA256). Sinon n'importe
//      qui pourrait marquer une commande comme payée.
//   2. Idempotency : Chargily peut renvoyer le même event plusieurs fois. On
//      ne traite la transition payment_status -> 'paid' qu'une seule fois (la
//      mise à jour conditionnelle ".eq(payment_status, 'pending')" + le trigger
//      SQL nous protègent).
//   3. La confirmation de paiement vient UNIQUEMENT du webhook. La redirection
//      `success_url` est cosmétique (le client peut fermer son navigateur).
//   4. On répond 200 vite — toujours. Même en cas d'erreur métier on log et on
//      renvoie 200 pour éviter les retries Chargily inutiles (sauf erreur de
//      signature → 401, et erreur de body → 400).
//
// L'UPDATE de `orders.payment_status` doit se faire avec un client `service_role`
// (bypass RLS) car le webhook arrive sans session utilisateur Supabase.
// =============================================================================

import { NextResponse, type NextRequest } from "next/server";
import {
  verifyWebhookSignature,
  type ChargilyWebhookEvent,
} from "@/lib/payments/chargily";
import { extractFailureReason } from "@/lib/payments/failure-reason";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyMerchantNewOrder, notifyDriversTour } from "@/lib/fcm/triggers";

// Force le runtime Node (le helper utilise `node:crypto`) et évite tout cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 1. Body BRUT — la signature est calculée dessus, pas sur le JSON re-stringifié.
  const rawBody = await req.text();
  const signature = req.headers.get("signature");

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  // 2. Parse du payload une fois la signature vérifiée.
  let event: ChargilyWebhookEvent;
  try {
    event = JSON.parse(rawBody) as ChargilyWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (event.entity !== "event" || !event.data) {
    return NextResponse.json({ error: "Unexpected payload." }, { status: 400 });
  }

  const meta = event.data.metadata ?? null;
  const type = (meta && typeof meta.type === "string" ? meta.type : null) as
    | "order"
    | "topup"
    | "op_topup"
    | "ride"
    | "drive_sub"
    | "priority_sub"
    | null;

  const admin = createAdminClient();

  // -------------------------------------------------------------------------
  // ÉTAPE A — paiement d'une commande (metadata.type === "order")
  // -------------------------------------------------------------------------
  if (type === "order") {
    const orderId =
      meta && typeof meta.order_id === "string" ? meta.order_id : null;
    if (!orderId) {
      return NextResponse.json(
        { error: "metadata.order_id manquant." },
        { status: 400 }
      );
    }

    if (event.type === "checkout.paid") {
      // Défense en profondeur : le montant confirmé par Chargily doit être
      // EXACTEMENT le total de la commande (tous nos checkouts commande sont
      // créés côté serveur avec `orders.total_da`). Un écart = event croisé ou
      // anormal → on NE marque PAS payé et on log pour investigation.
      const { data: target } = await admin
        .from("orders")
        .select("total_da, status, payment_status, customer_id")
        .eq("id", orderId)
        .maybeSingle();
      if (!target) {
        console.error(
          "[chargily/webhook] order paid: commande inconnue",
          orderId
        );
        return NextResponse.json({ ok: true, unknown_order: true });
      }
      const paidAmount = Math.round(event.data.amount);
      if (paidAmount !== target.total_da) {
        console.error(
          `[chargily/webhook] montant inattendu pour ${orderId}: payé=${paidAmount} attendu=${target.total_da}`
        );
        return NextResponse.json(
          { ok: false, amount_mismatch: true },
          { status: 200 }
        );
      }

      // Transition payment_status pending -> paid (idempotente via le .eq).
      // C'est SEULEMENT ICI que la commande online devient visible/effective
      // pour le commerçant (cf. RLS 0068) et reçoit son numéro (trigger 0068).
      const { data: updated, error } = await admin
        .from("orders")
        .update({ payment_status: "paid" })
        .eq("id", orderId)
        .eq("payment_status", "pending")
        .select("id, merchant_id, customer_name, total_da")
        .maybeSingle();
      if (error) {
        console.error("[chargily/webhook] order paid failed:", error);
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 200 }
        );
      }
      // Premier passage seulement (updated non null) : on alerte le commerçant
      // MAINTENANT que le paiement est confirmé — push (app fermée) ; le board /
      // l'overlay (app ouverte) la voient via RLS au prochain poll/realtime.
      if (updated) {
        void notifyMerchantNewOrder({
          merchantId: updated.merchant_id,
          orderId: updated.id,
          customerName: updated.customer_name,
          totalDa: updated.total_da,
        });
        // Tournée online payée : prévient les livreurs du commerçant (no-op si
        // ce n'est pas une tournée). Reçu même app fermée / hors ligne.
        void notifyDriversTour({ orderId: updated.id });
        return NextResponse.json({ ok: true });
      }

      // updated === null : la transition pending→paid n'a PAS eu lieu.
      //   • commande déjà 'paid' → simple rejeu du webhook, rien à faire.
      //   • commande ANNULÉE entre-temps (ex. filet d'expiration mig 0295) alors
      //     que le client vient de payer sur un checkout ENCORE OUVERT → il a été
      //     DÉBITÉ pour une commande morte. FILET : on lui recrédite le montant
      //     payé sur son Coligo Pay (idempotent via chargily_checkout_id) + log
      //     pour réconciliation. Principe : JAMAIS un client débité sans
      //     contrepartie. (Le montant a déjà été vérifié == total_da ci-dessus.)
      if (
        target.payment_status !== "paid" &&
        target.customer_id &&
        event.data.id
      ) {
        const { error: compErr } = await (
          admin.from("customer_wallet_entries") as unknown as {
            insert: (row: Record<string, unknown>) => Promise<{
              error: { code?: string; message: string } | null;
            }>;
          }
        ).insert({
          customer_id: target.customer_id,
          order_id: orderId,
          type: "topup_credit",
          source: "topup",
          amount_da: paidAmount,
          chargily_checkout_id: event.data.id,
          note: `Paiement reçu APRÈS annulation de la commande ${orderId} — recrédité sur Coligo Pay.`,
        });
        if (compErr?.code === "23505") {
          // Rejeu du webhook : incident déjà recrédité + tracé → on n'en fait rien.
        } else {
          // Toute autre erreur de crédit est logguée (le webhook répond 200 quand
          // même) ; l'alerte ci-dessous garantit un traitement manuel.
          if (compErr) {
            console.error(
              "[chargily/webhook] compensation credit failed:",
              compErr.message
            );
          }
          // Trace pour l'ADMIN → alerte super-admin « payé après annulation »
          // (mig 0296, domaine finances, fenêtre 7 j). Écrite UNE FOIS par
          // incident (sur rejeu, le crédit renvoie 23505 → on ne repasse pas ici).
          await admin.from("admin_audit_log").insert({
            admin_email: "chargily",
            action: "paid_after_cancel",
            target_kind: "order",
            target_id: orderId,
            note:
              `${paidAmount} DA payés APRÈS annulation ` +
              `(status=${target.status}, payment_status=${target.payment_status}) → ` +
              (compErr
                ? "ÉCHEC du recrédit Coligo Pay — RÉCONCILIATION MANUELLE REQUISE."
                : "recrédités sur Coligo Pay du client."),
          });
          console.error(
            `[chargily/webhook] ⚠️ checkout.paid sur commande NON-payable ${orderId} ` +
              `(status=${target.status}, payment_status=${target.payment_status}) — ` +
              `client recrédité ${paidAmount} DA sur Coligo Pay.`
          );
        }
      }
      return NextResponse.json({ ok: true, already_processed: true });
    }

    if (
      event.type === "checkout.failed" ||
      event.type === "checkout.canceled" ||
      // Checkout jamais payé arrivé à expiration (client parti sans payer) :
      // même traitement — sinon la commande resterait `pending` pour toujours
      // (invisible commerçant via RLS 0068 mais occupant le créneau, et le
      // cashback/Coligo Pay réservés ne seraient jamais re-crédités).
      event.type === "checkout.expired"
    ) {
      const reason = extractFailureReason(event);
      // ON TRANCHE : la commande passe à `cancelled` (en plus de payment_status
      // = 'failed'). Cela :
      //   - la fait disparaître de la liste "Mes commandes" côté client (cf.
      //     filtre sur /commandes — on n'affiche QUE les online payées) ;
      //   - déclenche les triggers SQL de contre-passation, qui re-créditent
      //     automatiquement le cashback / Coligo Pay éventuellement dépensé
      //     pour cette commande (cf. refund_customer_*_on_cancel) ;
      //   - libère le créneau (max_orders_per_slot recompte au-dessus).
      // Le client retrouvera son panier INTACT côté navigateur (le cart store
      // n'est jamais vidé tant que la commande n'est pas confirmée paid).
      const { error } = await admin
        .from("orders")
        .update({
          status: "cancelled",
          payment_status: "failed",
          payment_failure_reason: reason,
        })
        .eq("id", orderId)
        .eq("payment_status", "pending");
      if (error) {
        console.error("[chargily/webhook] order cancel failed:", error);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true, ignored: event.type });
  }

  // -------------------------------------------------------------------------
  // ÉTAPE B — recharge Coligo Pay (metadata.type === "topup")
  //
  // Idempotency : UNIQUE INDEX uq_cwe_chargily_checkout sur
  // customer_wallet_entries(chargily_checkout_id) → un même checkout ne peut
  // créditer qu'une seule fois. ON CONFLICT (chargily_checkout_id) absorbe
  // les rejeux de Chargily.
  // -------------------------------------------------------------------------
  if (type === "topup") {
    const customerId =
      meta && typeof meta.customer_id === "string" ? meta.customer_id : null;
    if (!customerId) {
      return NextResponse.json(
        { error: "metadata.customer_id manquant." },
        { status: 400 }
      );
    }
    const checkoutId = event.data.id;
    if (!checkoutId) {
      return NextResponse.json(
        { error: "checkout id manquant." },
        { status: 400 }
      );
    }

    if (event.type === "checkout.paid") {
      // Montant : on prend l'amount confirmé par Chargily (source de vérité),
      // pas la valeur de metadata (modifiable par l'utilisateur).
      const amount = Math.round(event.data.amount);
      if (amount <= 0) {
        return NextResponse.json(
          { error: "Montant invalide." },
          { status: 400 }
        );
      }

      // INSERT direct via service_role (bypass RLS). L'idempotency est
      // garantie par l'UNIQUE INDEX partiel sur chargily_checkout_id :
      // un rejeu Chargily renvoie 23505, qu'on absorbe silencieusement.
      // On caste le `from` (Insert: never) car la table interdit l'INSERT
      // côté client RLS — mais en service_role on peut insérer.
      const { error: insertErr } = await (
        admin.from("customer_wallet_entries") as unknown as {
          insert: (row: {
            customer_id: string;
            order_id: null;
            type: "topup_credit";
            source: "topup";
            amount_da: number;
            chargily_checkout_id: string;
            note: string;
          }) => Promise<{ error: { code?: string; message: string } | null }>;
        }
      ).insert({
        customer_id: customerId,
        order_id: null,
        type: "topup_credit",
        source: "topup",
        amount_da: amount,
        chargily_checkout_id: checkoutId,
        note: `Recharge Coligo Pay via Chargily Pay (${checkoutId}).`,
      });

      if (insertErr && insertErr.code !== "23505") {
        console.error("[chargily/webhook] topup insert failed:", insertErr);
        return NextResponse.json(
          { ok: false, error: insertErr.message },
          { status: 200 }
        );
      }

      // Plafond glissant (mig 0241) : marque la réservation de quota consommée
      // pour qu'elle ne double-compte plus (credited_30d la remplace désormais).
      // Best-effort : une réservation absente/déjà consommée est sans effet ;
      // le crédit, lui, est déjà posé.
      const reservationId =
        meta && typeof meta.reservation_id === "string"
          ? meta.reservation_id
          : null;
      if (reservationId) {
        const rpc = admin.rpc.bind(admin) as unknown as (
          fn: string,
          args: Record<string, unknown>
        ) => Promise<{ error: { message: string } | null }>;
        const { error: consumeErr } = await rpc("consume_topup_reservation", {
          p_reservation_id: reservationId,
          p_checkout_id: checkoutId,
        });
        if (consumeErr) {
          console.warn(
            "[chargily/webhook] consume_topup_reservation:",
            consumeErr.message
          );
        }
      }

      return NextResponse.json({
        ok: true,
        already_processed: insertErr?.code === "23505",
      });
    }

    // checkout.failed / checkout.canceled sur un topup → on ne fait rien
    // (aucune écriture, le client n'a jamais été crédité).
    return NextResponse.json({ ok: true });
  }

  // -------------------------------------------------------------------------
  // ÉTAPE B' — recharge portefeuille OPÉRATEUR (metadata.type === "op_topup")
  //
  // Crédite le portefeuille opérateur (livreur/chauffeur/commerçant/partenaire)
  // via la RPC idempotente `credit_operator_topup_chargily` (client_operation_id
  // = "chargily:"+checkout_id → un même checkout ne crédite qu'une fois).
  // -------------------------------------------------------------------------
  if (type === "op_topup") {
    const walletId =
      meta && typeof meta.wallet_id === "string" ? meta.wallet_id : null;
    if (!walletId) {
      return NextResponse.json(
        { error: "metadata.wallet_id manquant." },
        { status: 400 }
      );
    }
    const checkoutId = event.data.id;
    if (!checkoutId) {
      return NextResponse.json(
        { error: "checkout id manquant." },
        { status: 400 }
      );
    }
    if (event.type === "checkout.paid") {
      const amount = Math.round(event.data.amount);
      if (amount <= 0) {
        return NextResponse.json(
          { error: "Montant invalide." },
          { status: 400 }
        );
      }
      const rpc = admin.rpc.bind(admin) as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
      const { error } = await rpc("credit_operator_topup_chargily", {
        p_wallet_id: walletId,
        p_amount_da: amount,
        p_checkout_id: checkoutId,
      });
      if (error) {
        console.error("[chargily/webhook] op_topup failed:", error);
        // 500 (et non 200) : on a vérifié la signature et le paiement est
        // « paid », donc une erreur ici est forcément transitoire (incident
        // BDD). Répondre 5xx pousse Chargily à RÉESSAYER — sinon le crédit
        // serait perdu à jamais. La RPC étant idempotente (client_operation_id
        // = "chargily:"+checkout_id), un réessai ne peut pas double-créditer.
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 500 }
        );
      }
    }
    // failed / canceled / expired sur une recharge → rien (jamais crédité).
    return NextResponse.json({ ok: true });
  }

  // -------------------------------------------------------------------------
  // ÉTAPE C — course Drive payée par carte (metadata.type === "ride")
  // Le client paie AVANT que la demande soit diffusée : le webhook pose le
  // SÉQUESTRE (`drive_card_paid`, mig 0145, idempotent), rembourse sur le
  // wallet si la course a été annulée entre-temps, puis déclenche la
  // diffusion aux chauffeurs (la course devient visible).
  // -------------------------------------------------------------------------
  if (type === "ride") {
    const rideId =
      meta && typeof meta.ride_id === "string" ? meta.ride_id : null;
    if (!rideId) {
      return NextResponse.json(
        { error: "metadata.ride_id manquant." },
        { status: 400 }
      );
    }
    if (event.type === "checkout.paid") {
      const rpc = admin.rpc.bind(admin) as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
      const { data, error } = await rpc("drive_card_paid", {
        p_ride_id: rideId,
        p_amount_da: Math.round(event.data.amount),
        p_checkout_id: event.data.id ?? null,
      });
      if (error) {
        console.error("[chargily/webhook] ride paid failed:", error);
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 200 }
        );
      }
      const row = (Array.isArray(data) ? data[0] : data) as {
        ok?: boolean;
        refunded?: boolean;
      };
      // Paiement encaissé et course toujours ouverte → diffusion maintenant.
      if (row?.ok && !row.refunded) {
        const { notifyChauffeursNewRide } = await import("@/lib/fcm/triggers");
        void notifyChauffeursNewRide({ rideId });
        // Chauffeurs démo : offres automatiques dès que la carte est payée.
        void rpc("drive_demo_respond", { p_ride_id: rideId });
      }
    }
    // Paiement échoué / abandonné : la demande (jamais diffusée, aucun débit)
    // est annulée automatiquement — le client est ramené au choix de gamme
    // avec un message, au lieu de devoir annuler lui-même (mig 0163).
    if (
      event.type === "checkout.failed" ||
      event.type === "checkout.canceled" ||
      event.type === "checkout.expired"
    ) {
      const rpc = admin.rpc.bind(admin) as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
      const { error } = await rpc("drive_card_failed", { p_ride_id: rideId });
      if (error)
        console.error("[chargily/webhook] ride card failed:", error.message);
    }
    return NextResponse.json({ ok: true });
  }

  // -------------------------------------------------------------------------
  // ÉTAPE D — abonnement chauffeur Drive par carte (metadata.type ===
  // "drive_sub") : activation immédiate via drive_sub_mark_paid (idempotent —
  // `already_approved` sur rejeu).
  // -------------------------------------------------------------------------
  if (type === "drive_sub") {
    const paymentId =
      meta && typeof meta.payment_id === "string" ? meta.payment_id : null;
    if (!paymentId) {
      return NextResponse.json(
        { error: "metadata.payment_id manquant." },
        { status: 400 }
      );
    }
    const rpc = admin.rpc.bind(admin) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    if (event.type === "checkout.paid") {
      const { error } = await rpc("drive_sub_mark_paid", {
        p_payment_id: paymentId,
        p_reviewer: "chargily",
      });
      if (error) {
        console.error("[chargily/webhook] drive_sub failed:", error);
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 200 }
        );
      }
    } else if (
      event.type === "checkout.failed" ||
      event.type === "checkout.canceled" ||
      event.type === "checkout.expired"
    ) {
      // Règle produit : carte = accepté OU refusé IMMÉDIATEMENT — un échec ne
      // laisse jamais de tentative « en attente » (parité avec le Pass, étape E).
      const { error } = await rpc("drive_sub_reject", {
        p_payment_id: paymentId,
        p_note: "Paiement carte échoué ou annulé (Chargily)",
        p_reviewer: "chargily",
      });
      if (error) {
        console.error("[chargily/webhook] drive_sub reject failed:", error);
      }
    }
    return NextResponse.json({ ok: true });
  }

  // ÉTAPE E — Pass Prioritaire par carte (metadata.type === "priority_sub") :
  // activation immédiate via priority_sub_mark_paid (idempotent). Échec/annulé →
  // on annule l'abo en attente pour ne rien laisser bloqué.
  // -------------------------------------------------------------------------
  if (type === "priority_sub") {
    const subId = meta && typeof meta.sub_id === "string" ? meta.sub_id : null;
    if (!subId) {
      return NextResponse.json(
        { error: "metadata.sub_id manquant." },
        { status: 400 }
      );
    }
    const rpc = admin.rpc.bind(admin) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    if (event.type === "checkout.paid") {
      const { error } = await rpc("priority_sub_mark_paid", {
        p_sub_id: subId,
        p_ref: "chargily",
      });
      if (error) {
        console.error("[chargily/webhook] priority_sub failed:", error);
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 200 }
        );
      }
    } else if (
      event.type === "checkout.failed" ||
      event.type === "checkout.canceled" ||
      event.type === "checkout.expired"
    ) {
      await (admin as unknown as import("@supabase/supabase-js").SupabaseClient)
        .from("priority_subscriptions")
        .update({ status: "cancelled" })
        .eq("id", subId)
        .eq("status", "pending");
    }
    return NextResponse.json({ ok: true });
  }

  // Type inconnu ou absent : on accepte pour éviter les retries.
  return NextResponse.json({ ok: true, skipped: true });
}
