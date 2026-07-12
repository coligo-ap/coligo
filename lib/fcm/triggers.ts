/**
 * Déclencheurs métier de push FCM.
 *
 * Le code applicatif n'appelle JAMAIS `sendFcm()` directement : il passe par
 * ces helpers qui :
 *  1) résolvent le bon `user_id` à partir d'un identifiant métier
 *     (`merchant_id` / `order_id`) ;
 *  2) chargent les tokens via service_role (RLS bypass — la cible n'est pas
 *     forcément l'utilisateur courant : un client qui crée une commande
 *     déclenche une push au commerçant) ;
 *  3) formattent le titre/body côté serveur.
 *
 * Tous les helpers sont fire-and-forget : ils ne THROW jamais (catch interne)
 * et leurs erreurs n'arrêtent pas le flux applicatif.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { formatDA } from "@/lib/utils";
import type { OrderStatus } from "@/lib/types";
import { labelFor } from "@/lib/chat/messages";
import { isPushEligible } from "@/lib/chauffeur/dispatch-filter";
import {
  broadcastToChauffeurs,
  broadcastToCouriers,
} from "@/lib/realtime/broadcast";
import { storeAndPushNotification } from "@/lib/notifications/notify";
import { sendFcm } from "./send";

async function tokensFor(
  userId: string,
  role: "merchant" | "customer" | "courier" | "chauffeur"
): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("device_tokens")
    .select("token")
    .eq("user_id", userId)
    .eq("role", role);
  if (error) {
    console.warn("[fcm] tokensFor failed:", error);
    return [];
  }
  return (data ?? []).map((r) => r.token).filter(Boolean);
}

/**
 * Notification INTERNE du livreur (centre de notifications de l'application) —
 * doublée d'un push. La trace interne survit à un push manqué : le livreur
 * retrouve l'information en rouvrant l'app, même des jours plus tard.
 * Fire-and-forget.
 */
async function pushAndStoreForDriver(input: {
  driverId: string;
  kind: string;
  title: string;
  body: string;
  route: string;
}): Promise<void> {
  const admin = createAdminClient();

  await admin.from("driver_notifications").insert({
    driver_id: input.driverId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    route: input.route,
  });

  const { data: driver } = await admin
    .from("drivers")
    .select("user_id")
    .eq("id", input.driverId)
    .maybeSingle();
  if (!driver?.user_id) return;

  const tokens = await tokensFor(driver.user_id, "courier");
  if (tokens.length === 0) return;

  await sendFcm(
    tokens,
    { title: input.title, body: input.body },
    { route: input.route, kind: input.kind }
  );
}

/**
 * L'équipe Coligo a VALIDÉ le compte du livreur : il peut commencer à livrer.
 * Le push le ramène sur l'écran de félicitations (`/driver/bienvenue`).
 * Fire-and-forget — un push perdu ne bloque jamais la validation.
 */
export async function notifyDriverAccountVerified(input: {
  driverId: string;
}): Promise<void> {
  try {
    await pushAndStoreForDriver({
      driverId: input.driverId,
      kind: "driver_account_verified",
      title: "Votre compte est vérifié",
      body: "L'équipe Coligo a validé votre compte. Vous pouvez commencer à générer des revenus dès maintenant.",
      route: "/driver/bienvenue",
    });
  } catch (err) {
    console.warn("[fcm] notifyDriverAccountVerified failed:", err);
  }
}

/**
 * L'équipe Coligo a REFUSÉ le dossier : le livreur repart sur le formulaire
 * avec le motif affiché en tête. Fire-and-forget.
 */
export async function notifyDriverAccountRejected(input: {
  driverId: string;
  reason: string;
}): Promise<void> {
  try {
    await pushAndStoreForDriver({
      driverId: input.driverId,
      kind: "driver_account_rejected",
      title: "Votre dossier doit être corrigé",
      body: `L'équipe Coligo n'a pas pu valider votre inscription : ${input.reason}`,
      route: "/driver/inscription",
    });
  } catch (err) {
    console.warn("[fcm] notifyDriverAccountRejected failed:", err);
  }
}

/**
 * Notifie le commerçant qu'un livreur vient de soumettre son code de
 * référence — une nouvelle demande arrive sur /livreurs.
 * Fire-and-forget depuis driverSubmitCode.
 */
export async function notifyMerchantNewDriverRequest(input: {
  merchantId: string;
  driverFullName: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: merchant } = await admin
      .from("merchants")
      .select("user_id")
      .eq("id", input.merchantId)
      .maybeSingle();
    if (!merchant?.user_id) return;

    const tokens = await tokensFor(merchant.user_id, "merchant");
    if (tokens.length === 0) return;

    await sendFcm(
      tokens,
      {
        title: "Nouvelle demande de livreur",
        body: `${input.driverFullName} veut rejoindre ta boutique. À valider sur /livreurs.`,
      },
      { route: "/livreurs", kind: "merchant_new_driver_request" }
    );
  } catch (err) {
    console.warn("[fcm] notifyMerchantNewDriverRequest failed:", err);
  }
}

/**
 * Notifie le commerçant qu'une NOUVELLE commande est arrivée.
 * Appelé depuis l'action checkout côté client, après l'insert réussi.
 */
export async function notifyMerchantNewOrder(input: {
  merchantId: string;
  orderId: string;
  customerName: string | null;
  totalDa: number | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: merchant } = await admin
      .from("merchants")
      .select("user_id")
      .eq("id", input.merchantId)
      .maybeSingle();
    if (!merchant?.user_id) return;

    const tokens = await tokensFor(merchant.user_id, "merchant");
    if (tokens.length === 0) return;

    const body =
      (input.customerName ?? "Client") +
      (input.totalDa != null ? ` · ${formatDA(input.totalDa)}` : "");

    await sendFcm(
      tokens,
      { title: "Nouvelle commande Coligo", body },
      { route: `/orders/${input.orderId}`, kind: "merchant_new_order" }
    );
  } catch (err) {
    console.warn("[fcm] notifyMerchantNewOrder failed:", err);
  }
}

/**
 * Notifie le commerçant qu'une commande a été ANNULÉE PAR LE CLIENT (avant
 * acceptation). But : qu'il ne la prépare pas. Fire-and-forget.
 */
export async function notifyMerchantOrderCancelled(input: {
  merchantId: string;
  orderId: string;
  orderRef: string | null;
  customerName: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: merchant } = await admin
      .from("merchants")
      .select("user_id")
      .eq("id", input.merchantId)
      .maybeSingle();
    if (!merchant?.user_id) return;

    const tokens = await tokensFor(merchant.user_id, "merchant");
    if (tokens.length === 0) return;

    const ref = input.orderRef ? `#${input.orderRef}` : "Une commande";
    await sendFcm(
      tokens,
      {
        title: "Commande annulée par le client",
        body: `${ref}${input.customerName ? ` · ${input.customerName}` : ""} a été annulée — ne pas la préparer.`,
      },
      { route: `/orders/${input.orderId}`, kind: "merchant_order_cancelled" }
    );
  } catch (err) {
    console.warn("[fcm] notifyMerchantOrderCancelled failed:", err);
  }
}

/**
 * Notifie le LIVREUR affecté qu'une commande qu'il a acceptée vient d'être
 * ANNULÉE (par le commerçant ou le super-admin) AVANT récupération → il doit
 * s'arrêter immédiatement. Le `kind: 'driver_order_cancelled'` + `orderId`
 * permettent à l'app livreur d'afficher le pop-up et de couper la course.
 * Fire-and-forget.
 */
export async function notifyDriverOrderCancelled(input: {
  orderId: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: order } = await admin
      .from("orders")
      .select("delivery_driver_id, order_number, fulfillment_type")
      .eq("id", input.orderId)
      .maybeSingle();
    if (
      !order ||
      order.fulfillment_type !== "delivery" ||
      !order.delivery_driver_id
    ) {
      return;
    }
    const { data: driver } = await admin
      .from("drivers")
      .select("user_id")
      .eq("id", order.delivery_driver_id)
      .maybeSingle();
    if (!driver?.user_id) return;

    const tokens = await tokensFor(driver.user_id, "courier");
    if (tokens.length === 0) return;

    const ref = order.order_number ? `#${order.order_number}` : "";
    await sendFcm(
      tokens,
      {
        title: "Commande annulée",
        body: `La commande ${ref} a été annulée. Arrête-toi — contacte le support si besoin de détails.`,
      },
      {
        route: "/driver",
        kind: "driver_order_cancelled",
        orderId: input.orderId,
      }
    );
  } catch (err) {
    console.warn("[fcm] notifyDriverOrderCancelled failed:", err);
  }
}

/**
 * Notifie un livreur PRÉCIS que la plateforme lui a RETIRÉ une commande
 * (réattribution / remise au réseau). Le porteur a déjà changé en base au
 * moment de l'appel → on cible le livreur par son id, pas via la commande.
 * Broadcast temps réel en plus du push (app au premier plan). Fire-and-forget.
 */
export async function notifyDriverOrderWithdrawn(input: {
  driverId: string;
  orderId: string;
  orderRef: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: driver } = await admin
      .from("drivers")
      .select("user_id")
      .eq("id", input.driverId)
      .maybeSingle();
    if (!driver?.user_id) return;

    void broadcastToCouriers([driver.user_id], "order_withdrawn", {
      orderId: input.orderId,
    });

    const tokens = await tokensFor(driver.user_id, "courier");
    if (tokens.length === 0) return;

    const ref = input.orderRef ? `#${input.orderRef}` : "";
    await sendFcm(
      tokens,
      {
        title: "Course retirée",
        body: `La commande ${ref} t'a été retirée par la plateforme. Ne poursuis pas cette livraison — contacte le support si besoin.`,
      },
      {
        route: "/driver",
        kind: "driver_order_cancelled",
        orderId: input.orderId,
      }
    );
  } catch (err) {
    console.warn("[fcm] notifyDriverOrderWithdrawn failed:", err);
  }
}

/**
 * Notifie un livreur PRÉCIS que la plateforme vient de lui ATTRIBUER une
 * commande (réattribution directe par le support). Fire-and-forget.
 */
export async function notifyDriverOrderAssigned(input: {
  driverId: string;
  orderId: string;
  orderRef: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: driver } = await admin
      .from("drivers")
      .select("user_id")
      .eq("id", input.driverId)
      .maybeSingle();
    if (!driver?.user_id) return;

    void broadcastToCouriers([driver.user_id], "new_express", {
      orderId: input.orderId,
    });

    const tokens = await tokensFor(driver.user_id, "courier");
    if (tokens.length === 0) return;

    const ref = input.orderRef ? `#${input.orderRef}` : "";
    await sendFcm(
      tokens,
      {
        title: "Course attribuée 📦",
        body: `La plateforme t'a attribué la commande ${ref} — ouvre l'app pour la récupérer.`,
      },
      { route: "/driver", kind: "driver_new_express", orderId: input.orderId }
    );
  } catch (err) {
    console.warn("[fcm] notifyDriverOrderAssigned failed:", err);
  }
}

/**
 * Notifie le livreur affecté que sa course a été CLÔTURÉE PAR LA PLATEFORME
 * (support : validation manuelle, no-show en ligne « payé comme livré »…) —
 * il est payé comme une livraison normale. Complète le pop-up temps réel du
 * DriverCancelWatch (app ouverte) pour l'arrière-plan. Fire-and-forget.
 */
export async function notifyDriverCourseClosed(input: {
  orderId: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: order } = await admin
      .from("orders")
      .select("delivery_driver_id, order_number, fulfillment_type")
      .eq("id", input.orderId)
      .maybeSingle();
    if (
      !order ||
      order.fulfillment_type !== "delivery" ||
      !order.delivery_driver_id
    ) {
      return;
    }
    const { data: driver } = await admin
      .from("drivers")
      .select("user_id")
      .eq("id", order.delivery_driver_id)
      .maybeSingle();
    if (!driver?.user_id) return;

    const tokens = await tokensFor(driver.user_id, "courier");
    if (tokens.length === 0) return;

    const ref = order.order_number ? `#${order.order_number}` : "";
    await sendFcm(
      tokens,
      {
        title: "Livraison clôturée ✓",
        body: `La commande ${ref} a été validée par la plateforme : course terminée, tes gains sont crédités. Tu peux reprendre les courses.`,
      },
      {
        route: "/driver",
        kind: "driver_course_closed",
        orderId: input.orderId,
      }
    );
  } catch (err) {
    console.warn("[fcm] notifyDriverCourseClosed failed:", err);
  }
}

/**
 * Notifie un livreur qu'une INDEMNITÉ lui a été créditée par le support
 * (course retirée après déplacement, litige…). Fire-and-forget.
 */
export async function notifyDriverCompensation(input: {
  driverId: string;
  amountDa: number;
  orderRef: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: driver } = await admin
      .from("drivers")
      .select("user_id")
      .eq("id", input.driverId)
      .maybeSingle();
    if (!driver?.user_id) return;

    const tokens = await tokensFor(driver.user_id, "courier");
    if (tokens.length === 0) return;

    const ref = input.orderRef ? ` (commande #${input.orderRef})` : "";
    await sendFcm(
      tokens,
      {
        title: "Indemnité créditée 💰",
        body: `Le support t'a crédité ${formatDA(input.amountDa)}${ref}. Elle apparaîtra sur ton prochain relevé.`,
      },
      { route: "/driver/gains", kind: "driver_compensation" }
    );
  } catch (err) {
    console.warn("[fcm] notifyDriverCompensation failed:", err);
  }
}

/**
 * Notifie le client qu'un REMBOURSEMENT vient d'être crédité sur son
 * Coligo Pay (décision support sur une commande). Fire-and-forget.
 */
export async function notifyCustomerRefund(input: {
  orderId: string;
  amountDa: number;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: order } = await admin
      .from("orders")
      .select("customer_id, order_number")
      .eq("id", input.orderId)
      .maybeSingle();
    if (!order?.customer_id) return;

    const { data: customer } = await admin
      .from("customers")
      .select("user_id")
      .eq("id", order.customer_id)
      .maybeSingle();
    if (!customer?.user_id) return;

    const ref = order.order_number
      ? ` de la commande #${order.order_number}`
      : "";
    // Trace interne (cloche client, mig 0363) + push — la trace survit à un
    // push manqué.
    void storeAndPushNotification({
      userId: customer.user_id,
      audience: "customer",
      kind: "order_refund",
      title: "Remboursement effectué",
      body: `${formatDA(input.amountDa)} ont été crédités sur votre Coligo Pay au titre${ref}.`,
      route: `/commandes/${input.orderId}`,
      push: false,
    });

    const tokens = await tokensFor(customer.user_id, "customer");
    if (tokens.length === 0) return;

    await sendFcm(
      tokens,
      {
        title: "Remboursement effectué",
        body: `${formatDA(input.amountDa)} ont été crédités sur votre Coligo Pay au titre${ref}.`,
      },
      {
        route: `/commandes/${input.orderId}`,
        kind: "customer_refund",
      }
    );
  } catch (err) {
    console.warn("[fcm] notifyCustomerRefund failed:", err);
  }
}

/** Libellés clients par statut — alignés sur la copy commerçant. */
const STATUS_PUSH: Partial<
  Record<OrderStatus, { title: string; body: string }>
> = {
  accepted: {
    title: "Commande acceptée",
    body: "Le commerçant prépare votre commande.",
  },
  preparing: {
    title: "Commande acceptée",
    body: "Le commerçant prépare votre commande.",
  },
  ready: {
    title: "Commande prête",
    body: "Vous pouvez passer la récupérer.",
  },
  completed: {
    title: "Commande récupérée",
    body: "Merci d'avoir commandé sur Coligo.",
  },
  cancelled: {
    title: "Commande annulée",
    body: "Le commerçant a annulé votre commande.",
  },
};

/** Variantes LIVRAISON (copy adaptée : pas de « récupérer », parle du livreur). */
const STATUS_PUSH_DELIVERY: Partial<
  Record<OrderStatus, { title: string; body: string }>
> = {
  accepted: {
    title: "Commande acceptée",
    body: "Le commerçant prépare votre commande pour la livraison.",
  },
  preparing: {
    title: "Commande acceptée",
    body: "Le commerçant prépare votre commande pour la livraison.",
  },
  ready: {
    title: "Commande prête",
    body: "Votre commande est prête, un livreur va la récupérer.",
  },
  completed: {
    title: "Commande livrée ✓",
    body: "Votre commande a été livrée. Bon appétit !",
  },
  cancelled: {
    title: "Commande annulée",
    body: "Votre commande a été annulée.",
  },
};

/**
 * Notifie le client d'un changement de statut SIGNIFICATIF de sa commande.
 * Statuts silencieux (pending, etc.) : pas de push (on ne spamme pas).
 */
export async function notifyCustomerStatusChange(input: {
  orderId: string;
  newStatus: OrderStatus;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: order } = await admin
      .from("orders")
      .select("customer_id, fulfillment_type")
      .eq("id", input.orderId)
      .maybeSingle();
    if (!order?.customer_id) return;

    // Copy adaptée au mode (livraison vs retrait).
    const tmpl =
      order.fulfillment_type === "delivery"
        ? STATUS_PUSH_DELIVERY[input.newStatus]
        : STATUS_PUSH[input.newStatus];
    if (!tmpl) return;

    const { data: customer } = await admin
      .from("customers")
      .select("user_id")
      .eq("id", order.customer_id)
      .maybeSingle();
    if (!customer?.user_id) return;

    // Trace interne (cloche client, mig 0363) — même sans appareil enregistré.
    void storeAndPushNotification({
      userId: customer.user_id,
      audience: "customer",
      kind: "order_status",
      title: tmpl.title,
      body: tmpl.body,
      route: `/commandes/${input.orderId}`,
      push: false,
    });

    const tokens = await tokensFor(customer.user_id, "customer");
    if (tokens.length === 0) return;

    await sendFcm(tokens, tmpl, {
      route: `/commandes/${input.orderId}`,
      kind: "customer_status_change",
      status: input.newStatus,
    });
  } catch (err) {
    console.warn("[fcm] notifyCustomerStatusChange failed:", err);
  }
}

/**
 * Notifie TOUS les livreurs actifs d'un commerçant qu'une nouvelle course
 * EXPRESS est disponible (commande prête, en livraison, sans livreur attribué).
 * Déclenché quand le commerçant passe une commande express à « prête ».
 * Fire-and-forget. Multi-tokens (plusieurs livreurs liés au commerçant).
 */
/**
 * VTC — notifie les CHAUFFEURS en ligne proches du DÉPART d'une nouvelle course
 * (réseau global géolocalisé, `chauffeurs_present_near`, mig 0131). Best-effort.
 */
export async function notifyChauffeursNewRide(input: {
  rideId: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    // `dispatch_radius_km` (mig 0255) absent des types générés (Docker requis
    // pour `gen types`) → requête castée localement (pattern du repo).
    type RideDispatchRow = {
      status: string;
      chauffeur_id: string | null;
      customer_id: string | null;
      pickup_lat: number | null;
      pickup_lng: number | null;
      dest_lat: number | null;
      dest_lng: number | null;
      proposed_price_da: number | null;
      boost_amount_da: number | null;
      gamme: string | null;
      female_only: boolean | null;
      payment_method: string | null;
      online_paid_at: string | null;
      dispatch_radius_km: number | null;
    };
    const ridesTable = admin.from("rides") as unknown as {
      select: (s: string) => {
        eq: (
          c: string,
          v: string
        ) => {
          maybeSingle: () => Promise<{ data: RideDispatchRow | null }>;
        };
      };
    };
    const { data: ride } = await ridesTable
      .select(
        "status, chauffeur_id, customer_id, pickup_lat, pickup_lng, dest_lat, dest_lng, proposed_price_da, boost_amount_da, gamme, female_only, payment_method, online_paid_at, dispatch_radius_km"
      )
      .eq("id", input.rideId)
      .maybeSingle();
    if (
      !ride ||
      ride.status !== "searching" ||
      ride.chauffeur_id != null ||
      ride.pickup_lat == null ||
      ride.pickup_lng == null ||
      // Carte : payer AVANT la diffusion — le webhook rappellera ce trigger.
      (ride.payment_method === "card" && ride.online_paid_at == null)
    ) {
      return;
    }
    const rpc = admin.rpc.bind(admin) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    // Réglages plateforme : rayon de réception PAR DÉFAUT (super-admin, 10 km au
    // lancement) + tolérance angulaire « je rentre chez moi ». Le défaut sert à
    // la fois de pré-filtre de diffusion ET de rayon de repli pour les chauffeurs
    // qui n'ont pas personnalisé « Ma zone ».
    const { data: settings } = await admin
      .from("platform_settings")
      .select("drive_default_radius_km, drive_home_dir_tolerance_deg")
      .eq("id", true)
      .maybeSingle();
    const defaultRadius = Math.min(
      20,
      Math.max(
        5,
        Number(
          (settings as { drive_default_radius_km?: number } | null)
            ?.drive_default_radius_km ?? 10
        )
      )
    );
    const tolerance =
      (settings as { drive_home_dir_tolerance_deg?: number } | null)
        ?.drive_home_dir_tolerance_deg ?? 45;

    // Rayon de DIFFUSION (recherche) : élargi par les escalades successives
    // (mig 0255, dispatch_radius_km), borné 5..25 km. NB : ce rayon n'élargit
    // QUE le VIVIER interrogé. La garde finale reste la zone de travail de
    // CHAQUE chauffeur (isPushEligible ci-dessous, repli = defaultRadius) → on
    // ne pousse JAMAIS à un chauffeur hors de la zone qu'il a acceptée.
    const dispatchRadius = Math.min(
      25,
      Math.max(5, Number(ride.dispatch_radius_km ?? defaultRadius))
    );

    // Matching dur gamme + femme au volant (repli géré côté SQL) ; la RPC trie
    // déjà la diffusion : Premium > favoris du client > distance.
    const { data: near } = await rpc("chauffeurs_present_near", {
      p_lat: ride.pickup_lat,
      p_lng: ride.pickup_lng,
      p_radius_km: dispatchRadius,
      p_within_min: 3,
      p_gamme: ride.gamme ?? "classic",
      p_female_only: ride.female_only ?? false,
      p_customer_id: ride.customer_id ?? null,
    });
    const nearList =
      (near as
        | { user_id: string; chauffeur_id: string; dist_km: number }[]
        | null) ?? [];

    // COHÉRENCE push ⇄ liste : ne notifier un chauffeur QUE pour une course
    // qu'il VERRAIT réellement — dans SON rayon (« ma zone », sinon le défaut
    // plateforme) ET conforme à « je rentre chez moi » s'il l'a activé. Mêmes
    // règles que les écrans (fonction pure isPushEligible).
    const chIds = [
      ...new Set(nearList.map((r) => r.chauffeur_id).filter(Boolean)),
    ];
    type ChRow = {
      id: string;
      work_zone_radius_km: number | null;
      home_dir_active: boolean | null;
      home_lat: number | null;
      home_lng: number | null;
    };
    const chById = new Map<string, ChRow>();
    if (chIds.length) {
      // Colonnes hors types générés → cast local.
      const chTable = admin.from("chauffeurs") as unknown as {
        select: (s: string) => {
          in: (c: string, v: string[]) => Promise<{ data: ChRow[] | null }>;
        };
      };
      const { data: rows } = await chTable
        .select("id, work_zone_radius_km, home_dir_active, home_lat, home_lng")
        .in("id", chIds);
      for (const r of rows ?? []) chById.set(r.id, r);
    }

    const rideGeo = {
      pickup_lat: ride.pickup_lat,
      pickup_lng: ride.pickup_lng,
      dest_lat: ride.dest_lat,
      dest_lng: ride.dest_lng,
    };
    const eligible = nearList.filter((r) => {
      const ch = chById.get(r.chauffeur_id);
      if (!ch) return true; // pas d'info → comportement historique
      return isPushEligible(rideGeo, {
        distKm: Number(r.dist_km),
        radiusKm: ch.work_zone_radius_km ?? defaultRadius,
        homeDirActive: !!ch.home_dir_active,
        homeLat: ch.home_lat,
        homeLng: ch.home_lng,
        tolerance,
      });
    });

    const userIds = [
      ...new Set(eligible.map((r) => r.user_id).filter(Boolean)),
    ];
    if (userIds.length === 0) return;

    // DISPATCH FOREGROUND (instantané, sans polling) : broadcast ciblé sur le
    // canal perso de chaque chauffeur éligible — MÊME audience que le FCM. Les
    // apps OUVERTES affichent la course immédiatement via Realtime ; le FCM
    // ci-dessous couvre les apps fermées / en arrière-plan. Remplace l'ancien
    // abonnement GLOBAL aux INSERT de `rides` (O(courses × chauffeurs)).
    void broadcastToChauffeurs(userIds, "new_ride", { rideId: input.rideId });

    const tokenLists = await Promise.all(
      userIds.map((uid) => tokensFor(uid, "chauffeur"))
    );
    const tokens = [...new Set(tokenLists.flat())];
    if (tokens.length === 0) return;
    const total = (ride.proposed_price_da ?? 0) + (ride.boost_amount_da ?? 0);
    await sendFcm(
      tokens,
      {
        title:
          (ride.boost_amount_da ?? 0) > 0
            ? "⚡ Course boostée 🚗"
            : "Nouvelle course 🚗",
        body: `Un client propose ${formatDA(total)}. Fais ton offre !`,
      },
      // Clic sur la notif → la LISTE des demandes (où la course apparaît),
      // pas l'accueil (qui semblait « vide »). On porte le `rideId` (+ query
      // `?ride=`) pour que l'écran SURLIGNE la course concernée et la mette en
      // avant — le chauffeur identifie immédiatement la demande notifiée.
      {
        route: `/chauffeur/demandes?ride=${input.rideId}`,
        kind: "chauffeur_new_ride",
        rideId: input.rideId,
      }
    );
  } catch (err) {
    console.warn("[fcm] notifyChauffeursNewRide failed:", err);
  }
}

/**
 * VTC — la demande N'EST PLUS À PRENDRE (client a choisi un chauffeur, course
 * annulée pendant la recherche…) : broadcast `ride_gone` aux chauffeurs qui la
 * voyaient, pour qu'elle DISPARAISSE de leur écran IMMÉDIATEMENT au lieu
 * d'attendre le poll (jusqu'à 15 s pendant lesquelles un chauffeur pouvait
 * encore proposer sur une course déjà prise).
 *
 * Audience volontairement LARGE (présents autour du départ dans le rayon de
 * diffusion + auteurs d'une offre) SANS re-filtrer zone/direction : retirer un
 * id absent d'une liste est un no-op côté client, rater un destinataire
 * laisserait une course fantôme. Broadcast Realtime uniquement — AUCUN FCM
 * (retrait silencieux d'interface, pas une nouvelle information à notifier).
 *
 * `winnerUserId` accompagne le message : le chauffeur RETENU qui le reçoit
 * bascule immédiatement sur sa course (ceinture en plus du canal my-offers).
 */
export async function notifyChauffeursRideGone(input: {
  rideId: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    type RideGoneRow = {
      status: string;
      chauffeur_id: string | null;
      customer_id: string | null;
      pickup_lat: number | null;
      pickup_lng: number | null;
      gamme: string | null;
      female_only: boolean | null;
      dispatch_radius_km: number | null;
    };
    const ridesTable = admin.from("rides") as unknown as {
      select: (s: string) => {
        eq: (
          c: string,
          v: string
        ) => { maybeSingle: () => Promise<{ data: RideGoneRow | null }> };
      };
    };
    const { data: ride } = await ridesTable
      .select(
        "status, chauffeur_id, customer_id, pickup_lat, pickup_lng, gamme, female_only, dispatch_radius_km"
      )
      .eq("id", input.rideId)
      .maybeSingle();
    if (!ride || ride.pickup_lat == null || ride.pickup_lng == null) return;

    const rpc = admin.rpc.bind(admin) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;

    // Gagnant → payload, pour sa bascule instantanée. UNIQUEMENT si la course
    // est réellement attribuée/active : une course ANNULÉE garde son
    // chauffeur_id, et il ne faut pas l'envoyer « sur sa course » dans ce cas
    // (son écran course gère déjà l'annulation via l'issue backend).
    let winnerUserId: string | null = null;
    if (
      ride.chauffeur_id &&
      ["accepted", "arriving", "arrived", "in_progress"].includes(ride.status)
    ) {
      const { data: winner } = await admin
        .from("chauffeurs")
        .select("user_id")
        .eq("id", ride.chauffeur_id)
        .maybeSingle();
      winnerUserId = winner?.user_id ?? null;
    }

    const { data: settings } = await admin
      .from("platform_settings")
      .select("drive_default_radius_km")
      .eq("id", true)
      .maybeSingle();
    const defaultRadius = Math.min(
      20,
      Math.max(
        5,
        Number(
          (settings as { drive_default_radius_km?: number } | null)
            ?.drive_default_radius_km ?? 10
        )
      )
    );
    const dispatchRadius = Math.min(
      25,
      Math.max(5, Number(ride.dispatch_radius_km ?? defaultRadius))
    );

    // Présence élargie (10 min) : couvrir aussi un chauffeur dont le heartbeat
    // date un peu mais qui a l'écran demandes encore ouvert.
    const { data: near } = await rpc("chauffeurs_present_near", {
      p_lat: ride.pickup_lat,
      p_lng: ride.pickup_lng,
      p_radius_km: dispatchRadius,
      p_within_min: 10,
      p_gamme: ride.gamme ?? "classic",
      p_female_only: ride.female_only ?? false,
      p_customer_id: ride.customer_id ?? null,
    });
    const userIds = new Set(
      ((near as { user_id: string }[] | null) ?? []).map((r) => r.user_id)
    );

    // + Auteurs d'une offre sur la course (leur carte « Proposition » doit
    //   disparaître aussi, même s'ils sont sortis du rayon depuis).
    const { data: offerers } = await admin
      .from("ride_offers")
      .select("chauffeurs(user_id)")
      .eq("ride_id", input.rideId);
    for (const row of (offerers ?? []) as unknown as {
      chauffeurs: { user_id: string | null } | null;
    }[]) {
      if (row.chauffeurs?.user_id) userIds.add(row.chauffeurs.user_id);
    }

    void broadcastToChauffeurs([...userIds], "ride_gone", {
      rideId: input.rideId,
      winnerUserId,
    });
  } catch (err) {
    console.warn("[fcm] notifyChauffeursRideGone failed:", err);
  }
}

/**
 * APPEL IN-APP Drive (Agora) — fait « sonner » le pair même APP FERMÉE / en
 * arrière-plan. Le signaling temps réel (Supabase broadcast) ne marche qu'au
 * premier plan ; ce push réveille l'appelé et, au clic, l'ouvre sur l'écran de
 * course où l'invitation (ré-émise périodiquement) affichera l'appel entrant.
 *
 * `fromRole` = rôle de l'APPELANT. Le destinataire est l'AUTRE partie :
 *  - appelant client    → on notifie le CHAUFFEUR (route /chauffeur/course) ;
 *  - appelant chauffeur → on notifie le CLIENT (route /drive).
 */
export async function notifyRideIncomingCall(input: {
  rideId: string;
  fromRole: "client" | "chauffeur";
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: ride } = await admin
      .from("rides")
      .select("customer_id, chauffeur_id, status")
      .eq("id", input.rideId)
      .maybeSingle();
    if (!ride || !ride.chauffeur_id) return;

    const first = (n: string | null | undefined) =>
      (n ?? "").trim().split(/\s+/)[0] || null;

    if (input.fromRole === "client") {
      // Destinataire = chauffeur ; nom affiché = prénom du client.
      const [{ data: ch }, { data: cu }] = await Promise.all([
        admin
          .from("chauffeurs")
          .select("user_id")
          .eq("id", ride.chauffeur_id)
          .maybeSingle(),
        admin
          .from("customers")
          .select("full_name")
          .eq("id", ride.customer_id)
          .maybeSingle(),
      ]);
      if (!ch?.user_id) return;
      const tokens = await tokensFor(ch.user_id, "chauffeur");
      if (tokens.length === 0) return;
      await sendFcm(
        tokens,
        {
          title: "Appel entrant 📞",
          body: `${first(cu?.full_name) ?? "Le client"} vous appelle`,
        },
        {
          route: "/chauffeur/course",
          kind: "ride_call",
          rideId: input.rideId,
        }
      );
    } else {
      // Destinataire = client ; nom affiché = prénom du chauffeur.
      const [{ data: cu }, { data: ch }] = await Promise.all([
        admin
          .from("customers")
          .select("user_id")
          .eq("id", ride.customer_id)
          .maybeSingle(),
        admin
          .from("chauffeurs")
          .select("full_name")
          .eq("id", ride.chauffeur_id)
          .maybeSingle(),
      ]);
      if (!cu?.user_id) return;
      const tokens = await tokensFor(cu.user_id, "customer");
      if (tokens.length === 0) return;
      await sendFcm(
        tokens,
        {
          title: "Appel entrant 📞",
          body: `${first(ch?.full_name) ?? "Votre chauffeur"} vous appelle`,
        },
        { route: "/drive", kind: "ride_call", rideId: input.rideId }
      );
    }
  } catch (err) {
    console.warn("[fcm] notifyRideIncomingCall failed:", err);
  }
}

export async function notifyDriversNewExpress(input: {
  orderId: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: order } = await admin
      .from("orders")
      .select(
        "merchant_id, fulfillment_type, delivery_mode, delivery_driver_id, status, total_da"
      )
      .eq("id", input.orderId)
      .maybeSingle();
    if (
      !order ||
      order.fulfillment_type !== "delivery" ||
      order.delivery_mode !== "express" ||
      order.delivery_driver_id != null
    ) {
      return;
    }

    // Destinataires du push PAR COURSE = livreurs PRÉSENTS (heartbeat récent =
    // EN LIGNE) dans le rayon du commerçant (mig 0130). Les livreurs HORS LIGNE
    // ne reçoivent PAS de push par course (ils ont le teaser agrégé throttlé,
    // cf. notifyOfflineDriversExpressTeaser). Règle produit : ne pas spammer un
    // livreur déconnecté à chaque course.
    const userIdSet = new Set<string>();

    const { data: merchant } = await admin
      .from("merchants")
      .select("latitude, longitude")
      .eq("id", order.merchant_id)
      .maybeSingle();
    if (merchant?.latitude != null && merchant?.longitude != null) {
      const rpc = admin.rpc.bind(admin) as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
      const { data: near } = await rpc("drivers_present_near", {
        p_lat: merchant.latitude,
        p_lng: merchant.longitude,
        p_radius_km: 6,
        p_within_min: 3,
      });
      for (const r of (near as { user_id: string }[] | null) ?? []) {
        if (r.user_id) userIdSet.add(r.user_id);
      }
    }

    const userIds = [...userIdSet];
    if (userIds.length === 0) return;

    // DISPATCH FOREGROUND ciblé : broadcast aux livreurs PROCHES (même audience
    // que le FCM) sur leur canal perso → réception instantanée app ouverte, sans
    // abonnement global aux commandes. Le FCM ci-dessous couvre l'arrière-plan.
    void broadcastToCouriers(userIds, "new_express", {
      orderId: input.orderId,
    });

    const tokenLists = await Promise.all(
      userIds.map((uid) => tokensFor(uid, "courier"))
    );
    const tokens = [...new Set(tokenLists.flat())];
    if (tokens.length === 0) return;

    await sendFcm(
      tokens,
      {
        title: "Nouvelle course Express ⚡",
        body: `Une livraison de ${formatDA(order.total_da ?? 0)} à récupérer — fonce, le commerçant prépare.`,
      },
      { route: "/driver", kind: "driver_new_express" }
    );
  } catch (err) {
    console.warn("[fcm] notifyDriversNewExpress failed:", err);
  }
}

/**
 * Teaser Express pour les livreurs HORS LIGNE : « N livraisons express autour
 * de toi, mets-toi en ligne, gagne de l'argent ». Throttlé par livreur (RPC
 * express_teaser_targets, mig 0167 : cible la dernière position connue hors
 * ligne, marque last_teaser_at). Reçu même app fermée (Android natif).
 * Fire-and-forget. Appelé quand une nouvelle course express apparaît.
 */
export async function notifyOfflineDriversExpressTeaser(input: {
  orderId: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: order } = await admin
      .from("orders")
      .select(
        "merchant_id, fulfillment_type, delivery_mode, delivery_driver_id"
      )
      .eq("id", input.orderId)
      .maybeSingle();
    if (
      !order ||
      order.fulfillment_type !== "delivery" ||
      order.delivery_mode !== "express" ||
      order.delivery_driver_id != null
    ) {
      return;
    }

    const rpc = admin.rpc.bind(admin) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data: rows } = await rpc("express_teaser_targets", {
      p_merchant_id: order.merchant_id,
    });
    const targets =
      (rows as { user_id: string; available_count: number }[] | null) ?? [];
    if (targets.length === 0) return;

    const count = targets[0]?.available_count ?? targets.length;
    const userIds = [...new Set(targets.map((t) => t.user_id).filter(Boolean))];

    const tokenLists = await Promise.all(
      userIds.map((uid) => tokensFor(uid, "courier"))
    );
    const tokens = [...new Set(tokenLists.flat())];
    if (tokens.length === 0) return;

    const n =
      count > 1 ? `${count} livraisons express` : "Une livraison express";
    await sendFcm(
      tokens,
      {
        title: "Des courses Express t'attendent ⚡",
        body: `${n} ${count > 1 ? "sont disponibles" : "est disponible"} autour de toi. Mets-toi en ligne et gagne de l'argent !`,
      },
      { route: "/driver", kind: "driver_express_teaser" }
    );
  } catch (err) {
    console.warn("[fcm] notifyOfflineDriversExpressTeaser failed:", err);
  }
}

/**
 * Notifie les CLIENTS qui ont mis le commerçant en FAVORI qu'une nouvelle promo
 * / un code promo est disponible. Audience opt-in (favoris) → pas de spam de
 * masse. No-op si la promo n'est pas active. Reçu même app fermée / sur web.
 * Fire-and-forget, appelé à la création/activation d'une promo.
 */
export async function notifyCustomersPromo(input: {
  promotionId: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: promo } = await admin
      .from("promotions")
      .select("merchant_id, type, title_fr, code, status")
      .eq("id", input.promotionId)
      .maybeSingle();
    if (!promo || promo.status !== "active") return;

    const { data: merchant } = await admin
      .from("merchants")
      .select("name")
      .eq("id", promo.merchant_id)
      .maybeSingle();

    const { data: favs } = await admin
      .from("customer_favorites")
      .select("customer_id")
      .eq("merchant_id", promo.merchant_id);
    const custIds = [
      ...new Set(
        (favs ?? []).map((f) => f.customer_id).filter((x): x is string => !!x)
      ),
    ];
    if (custIds.length === 0) return;

    const { data: customers } = await admin
      .from("customers")
      .select("user_id")
      .in("id", custIds);
    const userIds = [
      ...new Set(
        (customers ?? []).map((c) => c.user_id).filter((u): u is string => !!u)
      ),
    ];
    if (userIds.length === 0) return;

    const tokenLists = await Promise.all(
      userIds.map((uid) => tokensFor(uid, "customer"))
    );
    const tokens = [...new Set(tokenLists.flat())];
    if (tokens.length === 0) return;

    const shop = merchant?.name ?? "Un commerçant favori";
    const body =
      promo.type === "promo_code" && promo.code
        ? `${shop} : code ${promo.code} — ${promo.title_fr}`
        : `${shop} : ${promo.title_fr}`;

    await sendFcm(
      tokens,
      { title: "Nouvelle promo 🎉", body },
      { route: "/favoris", kind: "customer_promo" }
    );
  } catch (err) {
    console.warn("[fcm] notifyCustomersPromo failed:", err);
  }
}

/**
 * Notifie les livreurs ACTIFS inscrits chez le commerçant qu'une nouvelle
 * commande en TOURNÉE est arrivée (à livrer sur le créneau choisi). Contrairement
 * à l'Express, la tournée est réservée aux livreurs du commerçant (pas de réseau
 * global). No-op si la commande n'est pas une tournée. Fire-and-forget ; reçu
 * même app fermée / hors ligne sur Android natif (push système).
 */
export async function notifyDriversTour(input: {
  orderId: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: order } = await admin
      .from("orders")
      .select("merchant_id, fulfillment_type, delivery_mode, total_da")
      .eq("id", input.orderId)
      .maybeSingle();
    if (
      !order ||
      order.fulfillment_type !== "delivery" ||
      order.delivery_mode !== "tour"
    ) {
      return;
    }

    // Destinataires = livreurs ACTIFS inscrits chez ce commerçant.
    const { data: links } = await admin
      .from("merchant_drivers")
      .select("driver_id")
      .eq("merchant_id", order.merchant_id)
      .eq("status", "active");
    const driverIds = (links ?? []).map((l) => l.driver_id).filter(Boolean);
    if (driverIds.length === 0) return;

    const { data: drivers } = await admin
      .from("drivers")
      .select("user_id")
      .in("id", driverIds);
    const userIds = [
      ...new Set(
        (drivers ?? []).map((d) => d.user_id).filter((u): u is string => !!u)
      ),
    ];
    if (userIds.length === 0) return;

    const tokenLists = await Promise.all(
      userIds.map((uid) => tokensFor(uid, "courier"))
    );
    const tokens = [...new Set(tokenLists.flat())];
    if (tokens.length === 0) return;

    await sendFcm(
      tokens,
      {
        title: "Nouvelle commande en tournée 📅",
        body: `Une commande de ${formatDA(order.total_da ?? 0)} à livrer sur ton créneau. Prépare ta tournée.`,
      },
      { route: "/driver/tournees", kind: "driver_new_tour" }
    );
  } catch (err) {
    console.warn("[fcm] notifyDriversTour failed:", err);
  }
}

/**
 * Notifie le client que le LIVREUR a récupéré sa commande et est en route.
 * Déclenché quand le livreur valide le pickup (statut SQL inchangé, donc pas
 * couvert par notifyCustomerStatusChange). Fire-and-forget.
 */
export async function notifyCustomerEnRoute(input: {
  orderId: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: order } = await admin
      .from("orders")
      .select("customer_id, fulfillment_type")
      .eq("id", input.orderId)
      .maybeSingle();
    if (!order?.customer_id || order.fulfillment_type !== "delivery") return;

    const { data: customer } = await admin
      .from("customers")
      .select("user_id")
      .eq("id", order.customer_id)
      .maybeSingle();
    if (!customer?.user_id) return;

    void storeAndPushNotification({
      userId: customer.user_id,
      audience: "customer",
      kind: "order_en_route",
      title: "Votre livreur est en route",
      body: "Le livreur a récupéré votre commande et arrive bientôt.",
      route: `/commandes/${input.orderId}`,
      push: false,
    });

    const tokens = await tokensFor(customer.user_id, "customer");
    if (tokens.length === 0) return;

    await sendFcm(
      tokens,
      {
        title: "Votre livreur est en route 🛵",
        body: "Le livreur a récupéré votre commande et arrive bientôt.",
      },
      {
        route: `/commandes/${input.orderId}`,
        kind: "customer_en_route",
      }
    );
  } catch (err) {
    console.warn("[fcm] notifyCustomerEnRoute failed:", err);
  }
}

/**
 * Notifie le client que le LIVREUR EST ARRIVÉ à sa porte. Déclenché quand le
 * livreur appuie sur « arrivé » (RPC mark_delivery_arrived, statut SQL
 * inchangé → pas couvert par notifyCustomerStatusChange). Fire-and-forget.
 */
export async function notifyCustomerArrived(input: {
  orderId: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: order } = await admin
      .from("orders")
      .select("customer_id, fulfillment_type")
      .eq("id", input.orderId)
      .maybeSingle();
    if (!order?.customer_id || order.fulfillment_type !== "delivery") return;

    const { data: customer } = await admin
      .from("customers")
      .select("user_id")
      .eq("id", order.customer_id)
      .maybeSingle();
    if (!customer?.user_id) return;

    void storeAndPushNotification({
      userId: customer.user_id,
      audience: "customer",
      kind: "order_arrived",
      title: "Votre livreur est arrivé",
      body: "Le livreur est à votre porte. Descendez récupérer votre commande.",
      route: `/commandes/${input.orderId}`,
      push: false,
    });

    const tokens = await tokensFor(customer.user_id, "customer");
    if (tokens.length === 0) return;

    await sendFcm(
      tokens,
      {
        title: "Votre livreur est arrivé 📍",
        body: "Le livreur est à votre porte. Descendez récupérer votre commande.",
      },
      {
        route: `/commandes/${input.orderId}`,
        kind: "customer_arrived",
      }
    );
  } catch (err) {
    console.warn("[fcm] notifyCustomerArrived failed:", err);
  }
}

/**
 * Notifie le DESTINATAIRE d'un message de chat in-app (client ↔ livreur).
 * L'expéditeur vient d'envoyer un message prédéfini (`code`) ; on pousse le
 * libellé au destinataire opposé. Fire-and-forget.
 */
export async function notifyOrderMessage(input: {
  orderId: string;
  senderRole: "customer" | "courier";
  code: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: order } = await admin
      .from("orders")
      .select("customer_id, delivery_driver_id")
      .eq("id", input.orderId)
      .maybeSingle();
    if (!order) return;

    const body = labelFor(input.code, "fr");

    if (input.senderRole === "customer") {
      // → notifie le LIVREUR attribué.
      if (!order.delivery_driver_id) return;
      const { data: driver } = await admin
        .from("drivers")
        .select("user_id")
        .eq("id", order.delivery_driver_id)
        .maybeSingle();
      if (!driver?.user_id) return;
      const tokens = await tokensFor(driver.user_id, "courier");
      if (tokens.length === 0) return;
      await sendFcm(
        tokens,
        { title: "Message du client 💬", body },
        { route: "/driver", kind: "order_message" }
      );
    } else {
      // → notifie le CLIENT.
      if (!order.customer_id) return;
      const { data: customer } = await admin
        .from("customers")
        .select("user_id")
        .eq("id", order.customer_id)
        .maybeSingle();
      if (!customer?.user_id) return;
      const tokens = await tokensFor(customer.user_id, "customer");
      if (tokens.length === 0) return;
      await sendFcm(
        tokens,
        { title: "Message de votre livreur 💬", body },
        { route: `/commandes/${input.orderId}`, kind: "order_message" }
      );
    }
  } catch (err) {
    console.warn("[fcm] notifyOrderMessage failed:", err);
  }
}

/**
 * Drive — notifie le CLIENT d'une course (chauffeur arrivé, etc.).
 * Fire-and-forget ; le poll client couvre le cas app ouverte.
 */
export async function notifyRideCustomer(
  rideId: string,
  kind: "arrived"
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: ride } = await admin
      .from("rides")
      .select("customer_id, chauffeurs(first_name, full_name)")
      .eq("id", rideId)
      .maybeSingle();
    if (!ride) return;
    const { data: cust } = await admin
      .from("customers")
      .select("user_id")
      .eq("id", ride.customer_id)
      .maybeSingle();
    if (!cust?.user_id) return;
    const tokens = await tokensFor(cust.user_id, "customer");
    if (tokens.length === 0) return;
    const ch = ride.chauffeurs as unknown as {
      first_name: string | null;
      full_name: string;
    } | null;
    const name = ch
      ? (ch.first_name ?? ch.full_name.split(" ")[0])
      : "Votre chauffeur";
    if (kind === "arrived") {
      await sendFcm(
        tokens,
        {
          title: "Votre chauffeur est arrivé 🚗",
          body: `${name} vous attend au point de départ.`,
        },
        { route: "/drive", kind: "drive_arrived" }
      );
    }
  } catch (err) {
    console.warn("[fcm] notifyRideCustomer failed:", err);
  }
}

/**
 * Drive — la plateforme (support) vient de CLÔTURER une course : annulée
 * (+ remboursement séquestre éventuel) ou terminée à la place du chauffeur.
 * Notifie le CHAUFFEUR et le CLIENT — l'app chauffeur (poll 20 s + Realtime)
 * et l'app client (my_active_ride) se resynchronisent d'elles-mêmes ; le push
 * couvre l'arrière-plan et EXPLIQUE la décision. Fire-and-forget.
 */
export async function notifyRideClosedByAdmin(input: {
  rideId: string;
  outcome: "completed" | "cancelled";
  refundedDa?: number;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: ride } = await admin
      .from("rides")
      .select("customer_id, chauffeur_id")
      .eq("id", input.rideId)
      .maybeSingle();
    if (!ride) return;

    // Chauffeur.
    if (ride.chauffeur_id) {
      const { data: ch } = await admin
        .from("chauffeurs")
        .select("user_id")
        .eq("id", ride.chauffeur_id)
        .maybeSingle();
      if (ch?.user_id) {
        const tmpl =
          input.outcome === "completed"
            ? {
                title: "Course clôturée ✓",
                body: "Le support a clôturé ta course : elle est comptée comme terminée et tes gains sont crédités. Tu peux reprendre les courses.",
              }
            : {
                title: "Course annulée",
                body: "Le support a annulé ta course en cours. Ne poursuis pas le trajet — contacte le support si besoin.",
              };
        void storeAndPushNotification({
          userId: ch.user_id,
          audience: "chauffeur",
          kind: "ride_closed_admin",
          title: tmpl.title,
          body: tmpl.body,
          route: "/chauffeur",
          push: false,
        });
        const tokens = await tokensFor(ch.user_id, "chauffeur");
        if (tokens.length > 0) {
          await sendFcm(tokens, tmpl, {
            route: "/chauffeur",
            kind: "drive_ride_closed_admin",
            rideId: input.rideId,
          });
        }
      }
    }

    // Client.
    const { data: cust } = await admin
      .from("customers")
      .select("user_id")
      .eq("id", ride.customer_id)
      .maybeSingle();
    if (cust?.user_id) {
      const tmpl =
        input.outcome === "completed"
          ? {
              title: "Course terminée",
              body: "Votre course a été clôturée par le support Coligo.",
            }
          : {
              title: "Course annulée par le support",
              body:
                input.refundedDa && input.refundedDa > 0
                  ? `Votre course a été annulée — ${formatDA(input.refundedDa)} recrédités sur votre Coligo Pay.`
                  : "Votre course a été annulée par le support Coligo.",
            };
      void storeAndPushNotification({
        userId: cust.user_id,
        audience: "customer",
        kind: "ride_closed_admin",
        title: tmpl.title,
        body: tmpl.body,
        route: "/drive",
        push: false,
      });
      const tokens = await tokensFor(cust.user_id, "customer");
      if (tokens.length > 0) {
        await sendFcm(tokens, tmpl, {
          route: "/drive",
          kind: "drive_ride_closed_admin",
        });
      }
    }
  } catch (err) {
    console.warn("[fcm] notifyRideClosedByAdmin failed:", err);
  }
}

/**
 * Coligo Pay — notifie le CLIENT d'un ajustement de son portefeuille par le
 * support (crédit ou débit motivé). Fire-and-forget.
 */
export async function notifyCustomerWalletAdjusted(input: {
  customerId: string;
  amountDa: number; // signé
  source: "topup" | "cashback";
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: cust } = await admin
      .from("customers")
      .select("user_id")
      .eq("id", input.customerId)
      .maybeSingle();
    if (!cust?.user_id) return;
    const tokens = await tokensFor(cust.user_id, "customer");
    if (tokens.length === 0) return;
    const label = input.source === "topup" ? "Coligo Pay" : "cashback";
    await sendFcm(
      tokens,
      input.amountDa > 0
        ? {
            title: "Crédit ajouté",
            body: `${formatDA(input.amountDa)} ont été crédités sur votre ${label} par le support Coligo.`,
          }
        : {
            title: "Ajustement de solde",
            body: `${formatDA(-input.amountDa)} ont été retirés de votre ${label} par le support Coligo. Contactez-nous pour toute question.`,
          },
      { route: "/wallet", kind: "wallet_adjusted" }
    );
  } catch (err) {
    console.warn("[fcm] notifyCustomerWalletAdjusted failed:", err);
  }
}

/**
 * Drive — notifie le CLIENT d'un remboursement (partiel/total) du support sur
 * une course TERMINÉE (crédit Coligo Pay). Fire-and-forget.
 */
export async function notifyRideCustomerRefund(input: {
  rideId: string;
  amountDa: number;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: ride } = await admin
      .from("rides")
      .select("customer_id")
      .eq("id", input.rideId)
      .maybeSingle();
    if (!ride) return;
    const { data: cust } = await admin
      .from("customers")
      .select("user_id")
      .eq("id", ride.customer_id)
      .maybeSingle();
    if (!cust?.user_id) return;
    void storeAndPushNotification({
      userId: cust.user_id,
      audience: "customer",
      kind: "ride_refund",
      title: "Remboursement effectué",
      body: `${formatDA(input.amountDa)} ont été crédités sur votre Coligo Pay au titre de votre course Drive.`,
      route: "/drive",
      push: false,
    });
    const tokens = await tokensFor(cust.user_id, "customer");
    if (tokens.length === 0) return;
    await sendFcm(
      tokens,
      {
        title: "Remboursement effectué",
        body: `${formatDA(input.amountDa)} ont été crédités sur votre Coligo Pay au titre de votre course Drive.`,
      },
      { route: "/drive", kind: "drive_ride_refund" }
    );
  } catch (err) {
    console.warn("[fcm] notifyRideCustomerRefund failed:", err);
  }
}

/**
 * Drive — notifie un CHAUFFEUR qu'une indemnité a été créditée sur son
 * portefeuille opérateur par le support. Fire-and-forget.
 */
export async function notifyChauffeurCompensation(input: {
  chauffeurId: string;
  amountDa: number;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: ch } = await admin
      .from("chauffeurs")
      .select("user_id")
      .eq("id", input.chauffeurId)
      .maybeSingle();
    if (!ch?.user_id) return;
    void storeAndPushNotification({
      userId: ch.user_id,
      audience: "chauffeur",
      kind: "ride_compensation",
      title: "Indemnité créditée",
      body: `Le support t'a crédité ${formatDA(input.amountDa)} sur ton portefeuille opérateur.`,
      route: "/chauffeur",
      push: false,
    });
    const tokens = await tokensFor(ch.user_id, "chauffeur");
    if (tokens.length === 0) return;
    await sendFcm(
      tokens,
      {
        title: "Indemnité créditée 💰",
        body: `Le support t'a crédité ${formatDA(input.amountDa)} sur ton portefeuille opérateur.`,
      },
      { route: "/chauffeur", kind: "chauffeur_compensation" }
    );
  } catch (err) {
    console.warn("[fcm] notifyChauffeurCompensation failed:", err);
  }
}

/**
 * Drive — notifie le DESTINATAIRE d'un message de chat de course (client ↔
 * chauffeur). L'expéditeur vient d'envoyer `body` ; on pousse au camp opposé.
 * Fire-and-forget (le poll/temps réel couvre le cas app ouverte).
 */
export async function notifyRideMessage(input: {
  rideId: string;
  senderRole: "customer" | "chauffeur";
  body: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: ride } = await admin
      .from("rides")
      .select("customer_id, chauffeur_id, chauffeurs(first_name, full_name)")
      .eq("id", input.rideId)
      .maybeSingle();
    if (!ride) return;
    const body = input.body.trim().slice(0, 140);

    if (input.senderRole === "chauffeur") {
      // → notifie le CLIENT
      if (!ride.customer_id) return;
      const { data: cust } = await admin
        .from("customers")
        .select("user_id")
        .eq("id", ride.customer_id)
        .maybeSingle();
      if (!cust?.user_id) return;
      const tokens = await tokensFor(cust.user_id, "customer");
      if (tokens.length === 0) return;
      const ch = ride.chauffeurs as unknown as {
        first_name: string | null;
        full_name: string;
      } | null;
      const name = ch
        ? (ch.first_name ?? ch.full_name.split(" ")[0])
        : "Votre chauffeur";
      await sendFcm(
        tokens,
        { title: `Message de ${name} 💬`, body },
        { route: "/drive", kind: "drive_message" }
      );
    } else {
      // → notifie le CHAUFFEUR
      if (!ride.chauffeur_id) return;
      const { data: ch } = await admin
        .from("chauffeurs")
        .select("user_id")
        .eq("id", ride.chauffeur_id)
        .maybeSingle();
      if (!ch?.user_id) return;
      const tokens = await tokensFor(ch.user_id, "chauffeur");
      if (tokens.length === 0) return;
      await sendFcm(
        tokens,
        { title: "Message du client 💬", body },
        { route: "/chauffeur/course", kind: "drive_message" }
      );
    }
  } catch (err) {
    console.warn("[fcm] notifyRideMessage failed:", err);
  }
}

/**
 * Drive — « Femme au volant » : une conductrice vient de se connecter →
 * prévient les clientes en repli (demandes female_only en recherche).
 * La RPC marque female_notified_at (une seule notification par demande).
 */
export async function notifyFemaleDriverOnline(): Promise<void> {
  try {
    const admin = createAdminClient();
    const rpc = admin.rpc.bind(admin) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data } = await rpc("drive_female_waiting_customers", {});
    const rows =
      (data as { ride_id: string; customer_user_id: string }[] | null) ?? [];
    if (rows.length === 0) return;
    const tokenLists = await Promise.all(
      [...new Set(rows.map((r) => r.customer_user_id))].map((uid) =>
        tokensFor(uid, "customer")
      )
    );
    const tokens = [...new Set(tokenLists.flat())];
    if (tokens.length === 0) return;
    await sendFcm(
      tokens,
      {
        title: "Une conductrice est en ligne 🎀",
        body: "Une conductrice vérifiée vient de se connecter près de vous.",
      },
      { route: "/drive", kind: "drive_female_online" }
    );
  } catch (err) {
    console.warn("[fcm] notifyFemaleDriverOnline failed:", err);
  }
}
