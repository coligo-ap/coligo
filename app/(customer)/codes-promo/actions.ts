"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// =============================================================================
// Ajout d'un code promo PLATEFORME au compte client (« Mes codes & bons »).
// Le client saisit un code public → on l'enregistre (grant) pour qu'il apparaisse
// dans sa liste. La validation/calcul de remise se fait au checkout.
// =============================================================================

export type ClaimResult =
  | { ok: true; reason: "claimed" | "already" }
  | { ok: false; error: string };

export async function claimPlatformPromo(
  rawCode: string
): Promise<ClaimResult> {
  const code = (rawCode ?? "").trim();
  if (!code) return { ok: false, error: "Saisis un code." };
  if (code.length > 40) return { ok: false, error: "Code trop long." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Reconnecte-toi." };

  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => PromiseLike<{
      data: { ok: boolean; reason: string; starts_at?: string | null } | null;
      error: { message: string } | null;
    }>
  )("claim_platform_promo", { p_code: code });

  if (error) {
    return { ok: false, error: "Vérification impossible. Réessaie." };
  }
  if (!data?.ok) {
    // Motifs PRÉCIS (mig 0436) : un code pas encore commencé ne dit plus
    // « n'est plus actif » (cas vécu APP20 — décalage de date de début).
    const reason = data?.reason ?? "invalid";
    const startsAt = data?.starts_at
      ? new Intl.DateTimeFormat("fr-DZ", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Africa/Algiers",
        }).format(new Date(data.starts_at))
      : null;
    const msg =
      reason === "not_started"
        ? startsAt
          ? `Ce code n'est pas encore actif — il démarre le ${startsAt}.`
          : "Ce code n'est pas encore actif."
        : reason === "expired"
          ? "Ce code a expiré."
          : reason === "inactive"
            ? "Ce code n'est plus actif."
            : reason === "no_customer"
              ? "Profil client introuvable."
              : "Code invalide ou inexistant.";
    return { ok: false, error: msg };
  }

  revalidatePath("/codes-promo");
  return {
    ok: true,
    reason: data.reason === "already" ? "already" : "claimed",
  };
}
