"use server";

import { createHash, randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFeatureFlags } from "@/lib/data/feature-flags";
import { sharedCarts } from "@/lib/shared-cart/db";
import {
  createCheckout as createChargilyCheckout,
  buildCallbackUrls,
} from "@/lib/payments/chargily";
import { CHARGILY_MIN_AMOUNT_DA } from "@/lib/config/payment-limits";
import {
  checkIntlEligibility,
  getRequestCountry,
  type IntlRefusal,
} from "@/lib/payments/intl";
import {
  createIntlPaymentIntent,
  getPublishableKey,
} from "@/lib/payments/stripe";

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
  | { ok: true; url: string; reveal: string }
  | { ok: false; reason: "not_found" | "already_paid" | "expired" | "error" };

export type StartGuestIntlResult =
  | {
      ok: true;
      reveal: string;
      intent: {
        client_secret: string;
        publishable_key: string;
        eur_cents: number;
        total_da: number;
      };
    }
  | {
      ok: false;
      reason: "not_found" | "already_paid" | "expired" | "ineligible" | "error";
      message?: string;
    };

/**
 * SECRET DE RÉVÉLATION (mig 0412) : généré au démarrage du paiement et remis
 * au SEUL navigateur du payeur — après confirmation, la RPC ne révèle numéro
 * + code de retrait qu'à lui (le lien public, lui, continue de circuler).
 *
 * ⚠️ SÉCURITÉ (audit 31/07) : le hash n'est posé QU'UNE FOIS (UPDATE
 * conditionnel `payer_reveal_hash IS NULL`). Avant, chaque appel l'ÉCRASAIT :
 * n'importe quel porteur du lien pouvait démarrer un paiement SANS payer,
 * capter le secret courant, puis lire le code de retrait dès que la famille
 * réglait (et invalider au passage le secret du payeur légitime). Désormais
 * le PREMIER qui démarre garde la capacité de révélation ; les suivants
 * voient « payé » sans les codes — le propriétaire, lui, a tout sur SA
 * commande.
 */
async function mintRevealSecret(
  admin: unknown,
  cartId: string
): Promise<string> {
  const reveal = randomUUID().replace(/-/g, "");
  await (
    sharedCarts(admin) as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string
        ) => { is: (c: string, v: null) => PromiseLike<unknown> };
      };
    }
  )
    .update({
      payer_reveal_hash: createHash("sha256").update(reveal).digest("hex"),
    })
    .eq("id", cartId)
    .is("payer_reveal_hash", null);
  return reveal;
}

function intlRefusalText(reason: IntlRefusal): string {
  switch (reason) {
    case "country":
      return "Le paiement en euros n'est pas disponible depuis ta région.";
    case "order_min":
      return "Montant trop faible pour un paiement en euros.";
    case "order_max":
      return "Montant trop élevé pour un paiement en euros.";
    case "user_day":
    case "user_month":
      return "Plafond de paiements en euros atteint. Réessaye plus tard.";
    case "capacity":
      return "Paiements en euros momentanément indisponibles.";
    default:
      return "Paiement en euros indisponible pour cette commande.";
  }
}

/**
 * L'invité paie par CARTE INTERNATIONALE (rail Stripe € existant, mig 0376) :
 * éligibilité AUTORITAIRE au moment T (pays IP du PAYEUR, plafonds, taux
 * serveur jamais exposé), garde anti-double-débit (intents précédents
 * neutralisés), session tracée pour le rapprochement webhook — le webhook
 * Stripe existant marque payé (« premier paiement gagne » inchangé).
 */
export async function startGuestIntlPayment(
  ptoken: string
): Promise<StartGuestIntlResult> {
  try {
    // Kill-switch super-admin (feature_flags `intl_card`) : garde SERVEUR —
    // le sélecteur grisé côté front ne suffit pas, un appel direct doit être
    // refusé ici aussi.
    const flags = await getFeatureFlags();
    if (flags.intl_card.status !== "active") {
      return {
        ok: false,
        reason: "ineligible",
        message:
          "Le paiement par carte internationale est momentanément désactivé.",
      };
    }

    const admin = createAdminClient();
    const { data: cart } = await sharedCarts(admin)
      .select("id, order_id")
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
    if (!order || order.payment_method !== "online" || !order.customer_id) {
      return { ok: false, reason: "not_found" };
    }
    if (order.status === "cancelled") return { ok: false, reason: "expired" };
    if (
      order.payment_status === "paid" ||
      order.payment_status === "refunded"
    ) {
      return { ok: false, reason: "already_paid" };
    }

    // Éligibilité AUTORITAIRE — pays lu depuis la requête du PAYEUR (c'est
    // tout l'intérêt : la famille à l'étranger paie en €).
    const elig = await checkIntlEligibility({
      customerId: order.customer_id,
      totalDa: order.total_da,
      domain: "marketplace",
      mode: "authoritative",
    });
    if (!elig.ok) {
      return {
        ok: false,
        reason: "ineligible",
        message: intlRefusalText(elig.reason),
      };
    }
    const publishableKey = await getPublishableKey();
    if (!publishableKey) {
      return {
        ok: false,
        reason: "ineligible",
        message: "Paiement en euros momentanément indisponible.",
      };
    }

    // ANTI-DOUBLE-DÉBIT : neutralise les intents précédents de CETTE commande.
    const { supersedeStaleSessions, sweepStaleIntlSessions } =
      await import("@/lib/payments/intl-guard");
    await supersedeStaleSessions(admin, { orderId: order.id });
    void sweepStaleIntlSessions();

    if (order.payment_status === "failed") {
      await admin
        .from("orders")
        .update({ payment_status: "pending" })
        .eq("id", order.id);
    }

    const intent = await createIntlPaymentIntent({
      orderId: order.id,
      eurCents: elig.eur_cents!,
      description: `Commande Coligo #${order.pickup_code}`,
      metadata: {
        type: "order",
        order_id: order.id,
        client_operation_id: order.client_operation_id ?? "",
        customer_id: order.customer_id,
      },
    });

    // Session tracée — échec d'écriture = paiement REFUSÉ (jamais un paiement
    // qu'on ne saurait pas rapprocher).
    const { error: sessErr } = await (
      admin.from("intl_payment_sessions" as never) as unknown as {
        insert: (row: Record<string, unknown>) => Promise<{
          error: { message: string } | null;
        }>;
      }
    ).insert({
      order_id: order.id,
      customer_id: order.customer_id,
      stripe_payment_intent: intent.id,
      eur_cents: elig.eur_cents!,
      total_da: order.total_da,
      rate_da: elig.rate.rate_da,
      rate_source: elig.rate.source,
      ip_country: await getRequestCountry(),
    });
    if (sessErr) {
      console.error("[guest-pay] intl session insert:", sessErr.message);
      return { ok: false, reason: "error" };
    }

    return {
      ok: true,
      reveal: await mintRevealSecret(admin, cart.id as string),
      intent: {
        client_secret: intent.clientSecret,
        publishable_key: publishableKey,
        eur_cents: elig.eur_cents!,
        total_da: order.total_da,
      },
    };
  } catch (e) {
    console.error("[guest-pay] startGuestIntlPayment:", e);
    return { ok: false, reason: "error" };
  }
}

export async function startGuestPayment(
  ptoken: string
): Promise<StartGuestPaymentResult> {
  try {
    const admin = createAdminClient();
    const { data: cart } = await sharedCarts(admin)
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
    return {
      ok: true,
      url: checkout.checkout_url,
      reveal: await mintRevealSecret(admin, cart.id as string),
    };
  } catch (e) {
    console.error("[guest-pay] startGuestPayment:", e);
    return { ok: false, reason: "error" };
  }
}
