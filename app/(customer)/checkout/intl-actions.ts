"use server";

// =============================================================================
// Actions paiement international (diaspora) côté client authentifié.
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
