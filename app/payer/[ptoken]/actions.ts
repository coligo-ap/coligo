"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  createCheckout as createChargilyCheckout,
  buildCallbackUrls,
} from "@/lib/payments/chargily";
import { CHARGILY_MIN_AMOUNT_DA } from "@/lib/config/payment-limits";

// =============================================================================
// startGuestPayment — l'INVITÉ (sans compte) paie la commande du capitaine.
//
// Sécurité : le payment_token EST la capacité ; tout est revalidé ici en
// service_role. La session Chargily porte la metadata `type:'order'` STANDARD
// → le webhook existant fait foi, « premier paiement gagne » par son
// `UPDATE … WHERE payment_status='pending'`. Re-check `pending` juste avant de
// créer la session (fenêtre réduite au minimum). Les URLs succès/échec
// reviennent sur /payer/{ptoken} (page publique), JAMAIS sur les pages
// authentifiées du capitaine.
// =============================================================================

export type StartGuestPaymentResult =
  | { ok: true; url: string }
  | { ok: false; reason: "not_found" | "already_paid" | "expired" | "error" };

export async function startGuestPayment(
  ptoken: string
): Promise<StartGuestPaymentResult> {
  try {
    const admin = createAdminClient();
    // Table hors types générés → cast local du builder.
    const from = admin.from.bind(admin) as unknown as (t: string) => {
      select: (c: string) => {
        eq: (
          col: string,
          v: string
        ) => {
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
          }>;
        };
      };
    };
    const { data: cart } = await from("shared_carts")
      .select("id, order_id, share_token")
      .eq("payment_token", ptoken)
      .maybeSingle();
    if (!cart?.order_id) return { ok: false, reason: "not_found" };

    const { data: order } = await admin
      .from("orders")
      .select(
        "id, status, payment_status, payment_method, total_da, pickup_code, client_operation_id, customer_id"
      )
      .eq("id", cart.order_id as string)
      .maybeSingle();
    if (!order || order.payment_method !== "online") {
      return { ok: false, reason: "not_found" };
    }
    if (order.status === "cancelled") return { ok: false, reason: "expired" };
    if (
      order.payment_status === "paid" ||
      order.payment_status === "refunded"
    ) {
      return { ok: false, reason: "already_paid" };
    }
    if (order.total_da < CHARGILY_MIN_AMOUNT_DA) {
      return { ok: false, reason: "error" };
    }

    // Tentative précédente échouée → nouvelle tentative (même règle que
    // retryOnlineOrderPayment : on repasse `pending` pour refléter l'essai).
    if (order.payment_status === "failed") {
      await admin
        .from("orders")
        .update({ payment_status: "pending" })
        .eq("id", order.id);
    }

    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL ?? "https://coligo.app"
    ).replace(/\/+$/, "");
    // Webhook STANDARD (même endpoint que tout paiement de commande) ; les
    // URLs de retour, elles, reviennent sur la page publique de CE lien.
    const { webhookEndpoint } = buildCallbackUrls({
      context: "order",
      orderId: order.id,
    });
    const checkout = await createChargilyCheckout({
      amount: order.total_da,
      successUrl: `${appUrl}/payer/${ptoken}?st=success`,
      failureUrl: `${appUrl}/payer/${ptoken}?st=failure`,
      webhookEndpoint,
      locale: "fr",
      description: `Commande Coligo #${order.pickup_code}`,
      metadata: {
        type: "order",
        order_id: order.id,
        client_operation_id: order.client_operation_id ?? null,
        customer_id: order.customer_id ?? null,
      },
    });
    return { ok: true, url: checkout.checkout_url };
  } catch (e) {
    console.error("[guest-pay] startGuestPayment:", e);
    return { ok: false, reason: "error" };
  }
}
