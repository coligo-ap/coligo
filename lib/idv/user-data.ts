import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { IDV_ACTIVE_STATUSES, type IdvProfile, type IdvStatus } from "./types";
import { withTimeoutOrNull } from "@/lib/async/with-timeout";

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
  /** Dossier passé en vérification MANUELLE après un refus automatique (0371). */
  manual_fallback: boolean;
};

/** Dossier VIVANT de l'utilisateur connecté pour ce profil (ou null). */
export async function getMyIdvVerification(
  profile: IdvProfile
): Promise<IdvVerificationView | null> {
  const supabase = await createClient();
  // BORNE OBLIGATOIRE (cf. lib/auth/session.ts) : jamais laisser pendre au
  // réveil d'arrière-plan.
  const authResult = await withTimeoutOrNull(supabase.auth.getUser(), 4000);
  const user = authResult?.data.user ?? null;
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
  const result = await withTimeoutOrNull(
    (async () =>
      from("idv_verifications")
        .select(
          "id, status, document_type, mode, attempt, updated_at, manual_fallback"
        )
        .eq("user_id", user.id)
        .eq("profile", profile)
        .in("status", IDV_ACTIVE_STATUSES)
        .maybeSingle())(),
    4000
  );
  return (result?.data as IdvVerificationView | null) ?? null;
}

/**
 * DERNIER dossier de l'utilisateur pour ce profil, quel que soit son statut
 * (approuvé/refusé compris) — `getMyIdvVerification` ne voit que les dossiers
 * VIVANTS, donc une identité déjà vérifiée y est invisible. Utilisé par la
 * conformité d'espace (lib/idv/compliance.ts).
 */
export async function getMyLatestIdvVerification(
  profile: IdvProfile
): Promise<IdvVerificationView | null> {
  const supabase = await createClient();
  // BORNE OBLIGATOIRE — cette fonction fait foi pour le gate d'accès à
  // l'espace (lib/idv/compliance.ts) : un timeout ici doit résoudre vite et
  // JAMAIS pendre (sinon toute la navigation de l'espace se fige).
  const authResult = await withTimeoutOrNull(supabase.auth.getUser(), 4000);
  const user = authResult?.data.user ?? null;
  if (!user) return null;

  const admin = createAdminClient();
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
          order: (
            c: string,
            o: { ascending: boolean }
          ) => {
            limit: (
              n: number
            ) => Promise<{ data: Record<string, unknown>[] | null }>;
          };
        };
      };
    };
  };
  const result = await withTimeoutOrNull(
    (async () =>
      from("idv_verifications")
        .select(
          "id, status, document_type, mode, attempt, updated_at, manual_fallback"
        )
        .eq("user_id", user.id)
        .eq("profile", profile)
        .order("updated_at", { ascending: false })
        .limit(1))(),
    4000
  );
  return (result?.data?.[0] as IdvVerificationView | undefined) ?? null;
}
