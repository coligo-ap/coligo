import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Une mesure « hors ligne forcé » est-elle ACTIVE sur ce partenaire ?
 *
 * Le trou qu'elle bouche : la mesure mettait bien le partenaire hors ligne au
 * moment où l'équipe l'appliquait… puis il lui suffisait de retoucher son
 * interrupteur pour revenir en ligne. Une mise hors ligne qu'on annule d'un tap
 * n'est pas une sanction, c'est un désagrément de trois secondes.
 *
 * Lecture en service_role : le partenaire ne doit pas pouvoir influencer le
 * verdict qui le concerne.
 */
export async function isForcedOffline(
  kind: "driver" | "chauffeur",
  actorId: string
): Promise<boolean> {
  try {
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
    const { data } = await from("fraud_actions")
      .select("id, expires_at")
      .eq("actor_kind", kind)
      .eq("actor_id", actorId)
      .eq("action", "force_offline")
      .is("revoked_at", null);
    const now = Date.now();
    // Une mesure expirée ne bloque plus : sinon on punirait à vie sans le voir.
    return (data ?? []).some(
      (r) => !r.expires_at || new Date(r.expires_at).getTime() > now
    );
  } catch {
    // Indisponible : on NE bloque PAS. Empêcher tous les partenaires de
    // travailler parce qu'une lecture a échoué serait pire que le risque.
    return false;
  }
}
