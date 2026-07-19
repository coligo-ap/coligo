"use server";

// =============================================================================
// Actions paiement international (diaspora) côté client authentifié.
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Estimation « ≈ X € » affichée en PETIT sur le bouton de confirmation
 * (façon Uber/Bolt) quand la carte internationale est sélectionnée — le
 * client sait AVANT de confirmer combien sa carte sera débitée. On ne
 * renvoie que le MONTANT (jamais le taux) ; le montant autoritaire reste
 * celui figé à la création de l'intent. null = pas d'estimation affichable.
 */
export async function estimateIntlEur(totalDa: number): Promise<number | null> {
  try {
    if (!Number.isFinite(totalDa) || totalDa <= 0) return null;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: customer } = await supabase
      .from("customers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!customer) return null;
    const { checkIntlEligibility } = await import("@/lib/payments/intl");
    const elig = await checkIntlEligibility({
      customerId: customer.id,
      totalDa: Math.round(totalDa),
      domain: "marketplace",
      mode: "visibility",
    });
    return elig.ok ? elig.eur_cents : null;
  } catch {
    return null;
  }
}

/**
 * « Me prévenir » — le client qui bute sur « paiements € momentanément
 * indisponibles » (capacité plateforme atteinte) s'inscrit pour être notifié
 * à la réouverture (push envoyé depuis l'admin). Idempotent (PK customer_id).
 */
export async function joinIntlWaitlist(): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!customer) return { ok: false };

  const admin = createAdminClient();
  const { error } = await (
    admin.from("intl_capacity_waitlist" as never) as unknown as {
      upsert: (row: Record<string, unknown>) => Promise<{
        error: { message: string } | null;
      }>;
    }
  ).upsert({ customer_id: customer.id });
  if (error) {
    console.error("[intl] waitlist join failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}
