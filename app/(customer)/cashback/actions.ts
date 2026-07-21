"use server";

// =============================================================================
// Coligo Pay — Server Action : créer une recharge (topup) via Chargily Pay v2.
// =============================================================================
// ⚠️ ARGENT RÉEL — règles non négociables (cf. PARTIE A du prompt 18) :
//   - Plafond GLISSANT de recharge sur 30 jours (anti-fraude MVP). Lu dans
//     `platform_settings.max_topup_da_per_30d`, vérifié AVANT de créer le
//     checkout Chargily. Si la recharge ferait dépasser le plafond, refus.
//   - Le crédit n'est PAS posé ici : c'est le webhook qui pose l'écriture
//     `topup_credit` UNIQUEMENT à la confirmation Chargily (checkout.paid).
//     Idempotency garantie par `chargily_checkout_id UNIQUE`.
//   - Montants ENTIERS en DA, signés positifs.
//   - Bornes min/max par recharge (UX + anti-spam) : MIN=100 DA, MAX=plafond.
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createCheckout as createChargilyCheckout,
  buildCallbackUrls,
} from "@/lib/payments/chargily";
import {
  getMyCashbackHistory,
  type CustomerWalletEntry,
} from "@/lib/customer/cashback";
import { getAuthUser } from "@/lib/auth/session";
import { getCurrentCustomerFull } from "@/lib/auth/customer";
import { MIN_TOPUP_DA } from "@/lib/config/payment-limits";

export type CreateTopupResult =
  | { ok: true; checkout_url: string; checkout_id: string }
  | { ok: false; error: string; code?: "limit_reached" | "below_min" };

/**
 * Historique cashback du client connecté, pour le loader client TanStack
 * (pattern OrdersLoader / ColigoPayLoader). Le solde, lui, vient du cache
 * partagé `wallet-balances` (WalletBalanceValue). Ré-authentifié côté serveur
 * (RLS) ; seules les écritures source='cashback' du client sont renvoyées.
 */
export async function fetchCashbackHistory(): Promise<CustomerWalletEntry[]> {
  return getMyCashbackHistory(100);
}

/**
 * La recharge de ce checkout a-t-elle été CRÉDITÉE (preuve = écriture webhook
 * customer_wallet_entries.chargily_checkout_id) ? Sondé par l'overlay de
 * résultat natif — on ne croit jamais la redirection, seulement le webhook.
 * Scopé au client connecté (RLS).
 */
export async function isTopupPaid(checkoutId: string): Promise<boolean> {
  if (!checkoutId) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from("customer_wallet_entries")
    .select("id")
    .eq("chargily_checkout_id", checkoutId)
    .maybeSingle();
  return !!data;
}

export async function createTopup(
  amountDa: number
): Promise<CreateTopupResult> {
  const supabase = await createClient();

  // Session + profil mémoïsés (helpers partagés cache()).
  if (!(await getAuthUser()))
    return { ok: false, error: "Tu dois te reconnecter." };
  const customer = await getCurrentCustomerFull();
  if (!customer) {
    return {
      ok: false,
      error: "Profil client introuvable. Recrée ton compte client.",
    };
  }

  const amount = Math.max(0, Math.floor(amountDa));
  if (amount < MIN_TOPUP_DA) {
    return {
      ok: false,
      error: `Le montant minimum de recharge est de ${MIN_TOPUP_DA} DA.`,
      code: "below_min",
    };
  }

  // Plafond glissant 30j (config plateforme).
  const { data: settings } = await supabase
    .from("platform_settings")
    .select("max_topup_da_per_30d")
    .eq("id", true)
    .maybeSingle();
  const cap = settings?.max_topup_da_per_30d ?? 50000;

  if (amount > cap) {
    return {
      ok: false,
      error: `Le montant maximum par recharge est de ${cap.toLocaleString("fr-DZ")} DA.`,
      code: "limit_reached",
    };
  }

  // Plafond glissant 30 j — RÉSERVATION ATOMIQUE (mig 0241). Sérialise les
  // checkouts concurrents : le crédit réel n'est posé qu'au webhook, donc un
  // simple read de `credited_30d` était contournable par recharges parallèles.
  // La réservation (verrou advisory + comptage credited+pending) empêche tout
  // dépassement avant même la création du checkout Chargily.
  const { data: resvRows, error: resvErr } = await supabase.rpc(
    "reserve_topup_quota" as never,
    { p_amount_da: amount } as never
  );
  const resv = (Array.isArray(resvRows) ? resvRows[0] : resvRows) as {
    ok: boolean;
    reason: string | null;
    reservation_id: string | null;
    remaining: number | null;
  } | null;
  if (resvErr || !resv || !resv.ok) {
    const remaining = resv?.remaining ?? 0;
    return {
      ok: false,
      error:
        remaining > 0
          ? `Plafond mensuel atteint. Tu peux encore recharger ${remaining.toLocaleString("fr-DZ")} DA sur les 30 derniers jours.`
          : "Plafond mensuel atteint. Réessaie dans quelques jours.",
      code: "limit_reached",
    };
  }
  const reservationId = resv.reservation_id;

  try {
    const { successUrl, failureUrl, webhookEndpoint } = buildCallbackUrls({
      context: "topup",
    });
    const checkout = await createChargilyCheckout({
      amount,
      successUrl,
      failureUrl,
      webhookEndpoint,
      locale: "fr",
      description: `Recharge Coligo Pay (${amount.toLocaleString("fr-DZ")} DA)`,
      metadata: {
        type: "topup",
        customer_id: customer.id,
        amount_da: amount,
        // Repris par le webhook pour marquer la réservation consommée (le crédit
        // remplace alors la réservation dans le comptage du plafond).
        reservation_id: reservationId,
      },
    });
    return {
      ok: true,
      checkout_url: checkout.checkout_url,
      checkout_id: checkout.id,
    };
  } catch (e) {
    // Checkout non créé → on libère la réservation pour ne pas geler le quota.
    if (reservationId) {
      await supabase.rpc(
        "release_topup_reservation" as never,
        {
          p_reservation_id: reservationId,
        } as never
      );
    }
    return {
      ok: false,
      error:
        e instanceof Error
          ? `Recharge indisponible : ${e.message}`
          : "Recharge indisponible.",
    };
  }
}

/* ───────────── Recharge Coligo Pay par CARTE INTERNATIONALE (€, Stripe) ─────────────
   Même contrat d'argent que la recharge Chargily ci-dessus : plafond glissant
   30 j RÉSERVÉ avant de créer le paiement, crédit posé UNIQUEMENT par le
   webhook (idempotent). Seul le rail change — feuille de paiement embarquée
   (carte, Apple Pay, Google Pay) au lieu du navigateur Chargily.
   Coupable d'un seul geste par le super-admin : « € pour recharger Coligo Pay »
   (intl_payment_settings.enabled_wallet, domaine 'wallet'). */

export type CustomerTopupIntlResult =
  | {
      ok: true;
      client_secret: string;
      publishable_key: string;
      eur_cents: number;
      total_da: number;
    }
  | { ok: false; error: string; code?: "limit_reached" | "below_min" | "intl" };

export async function createCustomerTopupIntlPayment(
  amountDa: number
): Promise<CustomerTopupIntlResult> {
  const supabase = await createClient();
  if (!(await getAuthUser()))
    return { ok: false, error: "Tu dois te reconnecter." };
  const customer = await getCurrentCustomerFull();
  if (!customer) {
    return { ok: false, error: "Profil client introuvable." };
  }

  const amount = Math.max(0, Math.floor(amountDa));
  if (amount < MIN_TOPUP_DA) {
    return {
      ok: false,
      error: `Le montant minimum de recharge est de ${MIN_TOPUP_DA} DA.`,
      code: "below_min",
    };
  }
  const { data: settings } = await supabase
    .from("platform_settings")
    .select("max_topup_da_per_30d")
    .eq("id", true)
    .maybeSingle();
  const cap = settings?.max_topup_da_per_30d ?? 50000;
  if (amount > cap) {
    return {
      ok: false,
      error: `Le montant maximum par recharge est de ${cap.toLocaleString("fr-DZ")} DA.`,
      code: "limit_reached",
    };
  }

  // Réservation ATOMIQUE du quota 30 j (mig 0241) — identique au rail Chargily :
  // sans elle, deux recharges parallèles passeraient toutes les deux.
  const { data: resvRows, error: resvErr } = await supabase.rpc(
    "reserve_topup_quota" as never,
    { p_amount_da: amount } as never
  );
  const resv = (Array.isArray(resvRows) ? resvRows[0] : resvRows) as {
    ok: boolean;
    reason: string | null;
    reservation_id: string | null;
    remaining: number | null;
  } | null;
  if (resvErr || !resv || !resv.ok) {
    const remaining = resv?.remaining ?? 0;
    return {
      ok: false,
      error:
        remaining > 0
          ? `Plafond mensuel atteint. Tu peux encore recharger ${remaining.toLocaleString("fr-DZ")} DA sur les 30 derniers jours.`
          : "Plafond mensuel atteint. Réessaie dans quelques jours.",
      code: "limit_reached",
    };
  }
  const reservationId = resv.reservation_id;

  const releaseQuota = async () => {
    if (!reservationId) return;
    await supabase.rpc(
      "release_topup_reservation" as never,
      { p_reservation_id: reservationId } as never
    );
  };

  try {
    const [{ checkIntlEligibility, getRequestCountry }, stripeMod] =
      await Promise.all([
        import("@/lib/payments/intl"),
        import("@/lib/payments/stripe"),
      ]);
    // Domaine 'wallet' + plafonds € du client (jour/mois/plateforme) évalués
    // en mode autoritaire : le taux est rafraîchi et la capacité auditée.
    const elig = await checkIntlEligibility({
      customerId: customer.id,
      totalDa: amount,
      domain: "wallet",
      mode: "authoritative",
    });
    if (!elig.ok) {
      await releaseQuota();
      return {
        ok: false,
        code: "intl",
        error:
          elig.reason === "order_min"
            ? "Montant trop faible pour la carte internationale."
            : elig.reason === "order_max"
              ? "Montant trop élevé pour la carte internationale."
              : elig.reason === "user_day" ||
                  elig.reason === "user_month" ||
                  elig.reason === "capacity"
                ? "Plafond carte internationale atteint."
                : "Carte internationale indisponible pour le moment.",
      };
    }
    const publishableKey = await stripeMod.getPublishableKey();
    if (!publishableKey) {
      await releaseQuota();
      return { ok: false, code: "intl", error: "Paiement € indisponible." };
    }
    const intent = await stripeMod.createIntlPaymentIntent({
      orderId: customer.id,
      eurCents: elig.eur_cents!,
      description: "Recharge Coligo Pay",
      metadata: {
        type: "customer_topup_intl",
        customer_id: customer.id,
        ...(reservationId ? { reservation_id: reservationId } : {}),
      },
    });
    const admin = createAdminClient();
    const { error: sessErr } = await (
      admin.from("intl_payment_sessions" as never) as unknown as {
        insert: (row: Record<string, unknown>) => Promise<{
          error: { message: string } | null;
        }>;
      }
    ).insert({
      topup_customer_id: customer.id,
      customer_id: customer.id,
      stripe_payment_intent: intent.id,
      eur_cents: elig.eur_cents!,
      total_da: amount,
      rate_da: elig.rate.rate_da,
      rate_source: elig.rate.source,
      ip_country: await getRequestCountry(),
    });
    if (sessErr) {
      await releaseQuota();
      return { ok: false, code: "intl", error: "Recharge indisponible." };
    }
    return {
      ok: true,
      client_secret: intent.clientSecret,
      publishable_key: publishableKey,
      eur_cents: elig.eur_cents!,
      total_da: amount,
    };
  } catch (e) {
    await releaseQuota();
    return {
      ok: false,
      error:
        e instanceof Error
          ? `Recharge indisponible : ${e.message}`
          : "Recharge indisponible.",
    };
  }
}

/** Le rail « carte internationale » est-il proposable au client pour CE
 *  montant ? (interrupteur super-admin + pays + bornes € + plafonds). */
export async function customerTopupIntlAvailability(
  amountDa?: number
): Promise<{ available: boolean; min_eur_cents: number }> {
  try {
    const customer = await getCurrentCustomerFull();
    if (!customer) return { available: false, min_eur_cents: 500 };
    const { checkIntlEligibility, getIntlOrderBoundsEur } =
      await import("@/lib/payments/intl");
    const [elig, bounds] = await Promise.all([
      checkIntlEligibility({
        customerId: customer.id,
        domain: "wallet",
        ...(amountDa != null && amountDa > 0 ? { totalDa: amountDa } : {}),
        mode: "visibility",
      }),
      getIntlOrderBoundsEur(),
    ]);
    return { available: elig.ok, min_eur_cents: bounds.min_eur_cents };
  } catch {
    return { available: false, min_eur_cents: 500 };
  }
}
