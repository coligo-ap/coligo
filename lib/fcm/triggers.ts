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
import { sendFcm } from "./send";

async function tokensFor(
  userId: string,
  role: "merchant" | "customer" | "courier"
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

    // Livreurs ACTIFS liés à ce commerçant.
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
    const userIds = (drivers ?? [])
      .map((d) => d.user_id)
      .filter((x): x is string => !!x);
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
        body: `Une livraison de ${formatDA(order.total_da ?? 0)} est prête à récupérer.`,
      },
      { route: "/driver", kind: "driver_new_express" }
    );
  } catch (err) {
    console.warn("[fcm] notifyDriversNewExpress failed:", err);
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
