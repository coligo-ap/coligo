import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/** Cookie posé par /r/[code] (30 j) — consommé à la création du profil client. */
export const REFERRAL_COOKIE = "coligo_ref";

/** Alphabet des codes : lisible sans ambiguïté (pas de O/I/0/1) — cf. mig 0403. */
function sanitizeReferralCode(raw?: string | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  const code = raw.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "");
  return code.length === 8 ? code : null;
}

/**
 * Rattache un code de parrainage au NOUVEAU client. BEST-EFFORT ABSOLU :
 * cette fonction ne jette JAMAIS — l'inscription ne doit jamais échouer ni
 * ralentir à cause du parrainage. Priorité au code saisi dans le formulaire,
 * sinon au cookie posé par le lien /r/[code].
 *
 * Toutes les règles métier (programme actif, anti-auto-parrainage, filleul
 * déjà parrainé, plafond mensuel) sont tranchées par la RPC `attach_referral`
 * (service_role uniquement, mig 0403) — ici on ne fait que transporter.
 */
export async function attachReferralForNewCustomer(
  customerId: string,
  explicitCode?: string | null
): Promise<void> {
  try {
    const jar = await cookies();
    const code =
      sanitizeReferralCode(explicitCode) ??
      sanitizeReferralCode(jar.get(REFERRAL_COOKIE)?.value);
    if (!code) return;

    const admin = createAdminClient();
    // RPC hors types générés → bind OBLIGATOIRE (cf. reference_supabase_rpc_bind).
    const rpc = admin.rpc.bind(admin) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ error: { message: string } | null }>;
    const { error } = await rpc("attach_referral", {
      p_referee_customer_id: customerId,
      p_code: code,
    });
    if (error) {
      console.error("[referral] attach_referral:", error.message);
      return;
    }

    // Attribution tranchée (acceptée ou refusée métier) → le cookie a servi.
    try {
      jar.delete(REFERRAL_COOKIE);
    } catch {
      /* contexte sans écriture cookie : sans gravité, il expirera */
    }
  } catch (e) {
    console.error("[referral] attach best-effort:", e);
  }
}
