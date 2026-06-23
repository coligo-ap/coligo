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
    const { data: ride } = await admin
      .from("rides")
      .select(
        "status, chauffeur_id, customer_id, pickup_lat, pickup_lng, dest_lat, dest_lng, proposed_price_da, boost_amount_da, gamme, female_only, payment_method, online_paid_at"
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
    // Matching dur gamme + femme au volant (repli géré côté SQL) ; la RPC trie
    // déjà la diffusion : Premium > favoris du client > distance.
    const { data: near } = await rpc("chauffeurs_present_near", {
      p_lat: ride.pickup_lat,
      p_lng: ride.pickup_lng,
      p_radius_km: 8,
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
    // qu'il VERRAIT réellement — dans SON rayon (« ma zone ») ET conforme à
    // « je rentre chez moi » s'il l'a activé. Mêmes règles que les écrans
    // (fonction pure isPushEligible). Rayon non personnalisé (NULL) → pas de
    // restriction de rayon (comportement historique 8 km).
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
    let tolerance = 45;
    if (chIds.length) {
      // Colonnes hors types générés → cast local.
      const chTable = admin.from("chauffeurs") as unknown as {
        select: (s: string) => {
          in: (c: string, v: string[]) => Promise<{ data: ChRow[] | null }>;
        };
      };
      const [{ data: rows }, { data: st }] = await Promise.all([
        chTable
          .select(
            "id, work_zone_radius_km, home_dir_active, home_lat, home_lng"
          )
          .in("id", chIds),
        admin
          .from("platform_settings")
          .select("drive_home_dir_tolerance_deg")
          .eq("id", true)
          .maybeSingle(),
      ]);
      for (const r of rows ?? []) chById.set(r.id, r);
      tolerance =
        (st as { drive_home_dir_tolerance_deg: number } | null)
          ?.drive_home_dir_tolerance_deg ?? 45;
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
        radiusKm: ch.work_zone_radius_km,
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
      // pas l'accueil (qui semblait « vide »).
      { route: "/chauffeur/demandes", kind: "chauffeur_new_ride" }
    );
  } catch (err) {
    console.warn("[fcm] notifyChauffeursNewRide failed:", err);
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
