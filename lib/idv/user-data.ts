import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { IDV_ACTIVE_STATUSES, type IdvProfile, type IdvStatus } from "./types";

// =============================================================================
// IDV — lecture du dossier de L'UTILISATEUR CONNECTÉ (parcours client).
// Les tables idv_* n'ont aucune policy RLS → lecture service_role, self-gardée
// par la session ET filtrée user_id. On ne PROJETTE que les champs que
// l'utilisateur a le droit de voir : jamais les scores ni les extractions
// brutes (anti-gaming des seuils).
// =============================================================================

/** Vue « propriétaire » du dossier — champs sûrs uniquement. */
export type IdvVerificationView = {
  id: string;
  status: IdvStatus;
  document_type: string | null;
  mode: string;
  attempt: number;
  updated_at: string;
};

/** Dossier VIVANT de l'utilisateur connecté pour ce profil (ou null). */
export async function getMyIdvVerification(
  profile: IdvProfile
): Promise<IdvVerificationView | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  // Tables idv_* pas encore dans database.types.ts généré → cast local.
  const from = admin.from.bind(admin) as unknown as (t: string) => {
    select: (cols: string) => {
      eq: (
        c: string,
        v: string
      ) => {
        eq: (
          c: string,
          v: string
        ) => {
          in: (
            c: string,
            v: readonly string[]
          ) => {
            maybeSingle: () => Promise<{
              data: Record<string, unknown> | null;
            }>;
          };
        };
      };
    };
  };
  const { data } = await from("idv_verifications")
    .select("id, status, document_type, mode, attempt, updated_at")
    .eq("user_id", user.id)
    .eq("profile", profile)
    .in("status", IDV_ACTIVE_STATUSES)
    .maybeSingle();
  return (data as IdvVerificationView | null) ?? null;
}
