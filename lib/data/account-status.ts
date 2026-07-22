import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { withTimeoutOrNull } from "@/lib/async/with-timeout";

// =============================================================================
// État du COMPTE client : suspension décidée par l'équipe Coligo (mig 0397).
//
// Lu avec la session du client — la policy « propriétaire » de `customers` suffit
// (et `protect_customer_risk_fields` empêche toute écriture de ces champs par le
// client). On le dit franchement dans l'app : un compte suspendu qui échouerait
// silencieusement au moment de commander, ce serait pire que le blocage.
// =============================================================================

export type AccountBlock = { blocked: boolean; reason: string | null };

const NOT_BLOCKED: AccountBlock = { blocked: false, reason: null };

export const getMyAccountBlock = cache(async (): Promise<AccountBlock> => {
  try {
    const supabase = await createClient();
    // Colonnes hors `database.types.ts` généré (mig 0397) → accès casté.
    // `.bind` obligatoire (cf. reference_supabase_rpc_bind).
    const from = supabase.from.bind(supabase) as unknown as (t: string) => {
      select: (cols: string) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
        }>;
      };
    };
    // RLS filtre déjà sur le propriétaire → pas de `.eq` nécessaire.
    const res = await withTimeoutOrNull(
      from("customers").select("is_blocked, blocked_reason").maybeSingle(),
      4000
    );
    const row = res?.data;
    if (!row?.is_blocked) return NOT_BLOCKED;
    return {
      blocked: true,
      reason: (row.blocked_reason as string | null) ?? null,
    };
  } catch {
    // Jamais bloquer l'affichage sur une erreur de lecture.
    return NOT_BLOCKED;
  }
});
