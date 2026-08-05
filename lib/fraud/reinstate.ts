import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FraudActorKind } from "@/lib/fraud/model";

/**
 * Révoque toutes les sanctions anti-fraude « suspend » ACTIVES d'un compte —
 * la moitié anti-fraude d'une RÉACTIVATION TOTALE (l'autre moitié = lever le
 * flag natif is_blocked/is_frozen, propre à chaque espace).
 *
 * Sans ça, « Réactiver »/« Dégeler » depuis une fiche laissait la sanction
 * active dans le module Anti-fraude : le compte restait suspendu côté client
 * (customer_fraud_gate) ou re-gelable au prochain battement (bug vécu).
 *
 * Les révocations passent par la RPC admin_fraud_revoke_action EN SESSION
 * (re-gardée _fraud_require_admin côté SQL + journalisée + effets de bord
 * annulés) — le service_role ne sert qu'à LISTER les ids.
 */
export async function revokeActiveSuspendSanctions(
  kind: FraudActorKind,
  actorId: string,
  note: string
): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const from = admin.from.bind(admin) as unknown as (t: string) => {
    select: (c: string) => {
      eq: (
        c1: string,
        v1: string
      ) => {
        eq: (
          c2: string,
          v2: string
        ) => {
          eq: (
            c3: string,
            v3: string
          ) => {
            is: (
              c4: string,
              v4: null
            ) => Promise<{
              data: { id: string; expires_at: string | null }[] | null;
            }>;
          };
        };
      };
    };
  };
  const { data: sanctions } = await from("fraud_actions")
    .select("id, expires_at")
    .eq("actor_kind", kind)
    .eq("actor_id", actorId)
    .eq("action", "suspend")
    .is("revoked_at", null);
  const active = (sanctions ?? []).filter(
    (s) => !s.expires_at || new Date(s.expires_at).getTime() > Date.now()
  );
  if (active.length === 0) return {};

  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    f: string,
    a: Record<string, unknown>
  ) => Promise<{ error: { message: string } | null }>;
  for (const s of active) {
    const { error } = await rpc("admin_fraud_revoke_action", {
      p_action_id: s.id,
      p_note: note,
    });
    if (error) {
      return {
        error: `Sanction anti-fraude non révoquée : ${error.message}`,
      };
    }
  }
  return {};
}
