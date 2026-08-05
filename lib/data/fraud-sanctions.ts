import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";
import type { FraudActorKind } from "@/lib/fraud/model";

/**
 * Sanctions anti-fraude ACTIVES d'un compte (fraud_actions, mig 0374) —
 * partagé par les fiches admin (client, livreur, chauffeur, commerçant) qui
 * les affichent et les LÈVENT sur place, sans redirection vers le module.
 */
export type ActiveFraudSanction = {
  id: string;
  action: string;
  source: "auto" | "admin";
  reason: string;
  created_at: string;
  expires_at: string | null;
};

export async function getActiveFraudSanctions(
  kind: FraudActorKind,
  actorId: string
): Promise<ActiveFraudSanction[]> {
  // Self-guard : lecture service_role (bypass RLS) → non-admin ⇒ [] (mémoïsé).
  if (!(await isSuperAdmin())) return [];
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
          is: (
            c3: string,
            v3: null
          ) => {
            order: (
              c4: string,
              o: { ascending: boolean }
            ) => Promise<{ data: ActiveFraudSanction[] | null }>;
          };
        };
      };
    };
  };
  try {
    const { data } = await from("fraud_actions")
      .select("id, action, source, reason, created_at, expires_at")
      .eq("actor_kind", kind)
      .eq("actor_id", actorId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    // Une mesure expirée ne compte plus (sinon on punirait à vie sans le voir).
    return (data ?? []).filter(
      (r) => !r.expires_at || new Date(r.expires_at).getTime() > Date.now()
    );
  } catch {
    return [];
  }
}
