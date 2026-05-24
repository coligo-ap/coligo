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
import {
  createCheckout as createChargilyCheckout,
  buildCallbackUrls,
} from "@/lib/payments/chargily";
import { getTopupCreditedLast30dForCustomer } from "@/lib/customer/cashback";

const MIN_TOPUP_DA = 100;

export type CreateTopupResult =
  | { ok: true; checkout_url: string }
  | { ok: false; error: string; code?: "limit_reached" | "below_min" };

export async function createTopup(
  amountDa: number
): Promise<CreateTopupResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu dois te reconnecter." };

  const { data: customer } = await supabase
    .from("customers")
    .select("id, full_name, phone")
    .eq("user_id", user.id)
    .maybeSingle();
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

  const credited30d = await getTopupCreditedLast30dForCustomer(customer.id);
  if (credited30d + amount > cap) {
    const remaining = Math.max(0, cap - credited30d);
    return {
      ok: false,
      error:
        remaining > 0
          ? `Plafond mensuel atteint. Tu peux encore recharger ${remaining.toLocaleString("fr-DZ")} DA sur les 30 derniers jours.`
          : "Plafond mensuel atteint. Réessaie dans quelques jours.",
      code: "limit_reached",
    };
  }

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
      },
    });
    return { ok: true, checkout_url: checkout.checkout_url };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? `Recharge indisponible : ${e.message}`
          : "Recharge indisponible.",
    };
  }
}
