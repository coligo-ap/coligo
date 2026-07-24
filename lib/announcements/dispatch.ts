import { createAdminClient } from "@/lib/supabase/admin";
import { sendFcm } from "@/lib/fcm/send";
import { broadcastAnnouncements } from "@/lib/realtime/broadcast";

// =============================================================================
// Diffusion d'une ANNONCE (mig 0408) — partagée entre la console admin
// (publication immédiate) et le cron quotidien (publications programmées).
//   • Push FCM par audience (mapping livreur → rôle FCM `courier`), texte FR
//     (la langue par appareil n'est pas stockée — la POP-UP, elle, est dans la
//     langue de l'utilisateur), tap → accueil du rôle (le host affiche la
//     pop-up à l'ouverture).
//   • Pop-up « instantanée » : bump broadcast public par rôle.
// =============================================================================

export type DispatchableAnnouncement = {
  id: string;
  title_fr: string;
  body_fr: string;
  audiences: string[];
  channel: "push" | "popup" | "both";
  popup_mode: "next_open" | "instant" | "route";
};

/** Accueil de chaque rôle — la cible du tap push. */
const HOME_ROUTE: Record<string, string> = {
  customer: "/",
  merchant: "/dashboard",
  driver: "/driver",
  chauffeur: "/chauffeur",
};

/** Audience console → rôle de `device_tokens` (livreur = `courier`). */
const FCM_ROLE: Record<
  string,
  "customer" | "merchant" | "courier" | "chauffeur"
> = {
  customer: "customer",
  merchant: "merchant",
  driver: "courier",
  chauffeur: "chauffeur",
};

export async function dispatchAnnouncement(
  ann: DispatchableAnnouncement
): Promise<{ pushSent: number }> {
  let pushSent = 0;

  if (ann.channel === "push" || ann.channel === "both") {
    const admin = createAdminClient();
    for (const audience of ann.audiences) {
      const role = FCM_ROLE[audience];
      if (!role) continue;
      const { data } = await admin
        .from("device_tokens")
        .select("token")
        .eq("role", role);
      const tokens = [...new Set((data ?? []).map((r) => r.token))];
      if (tokens.length === 0) continue;
      const res = await sendFcm(
        tokens,
        { title: ann.title_fr, body: ann.body_fr },
        {
          route: HOME_ROUTE[audience] ?? "/",
          kind: "announcement",
          announcement_id: ann.id,
        }
      );
      pushSent += res.ok;
    }

    // Horodatage + compteur (idempotence cron : push_sent_at n'est posé qu'ici).
    const from = admin.from.bind(admin) as unknown as (t: string) => {
      update: (v: Record<string, unknown>) => {
        eq: (c: string, v2: string) => Promise<{ error: unknown }>;
      };
    };
    await from("announcements")
      .update({
        push_sent_at: new Date().toISOString(),
        push_sent_count: pushSent,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ann.id);
  }

  // Pop-up instantanée : les apps OUVERTES re-fetchent tout de suite.
  if (
    (ann.channel === "popup" || ann.channel === "both") &&
    ann.popup_mode === "instant"
  ) {
    void broadcastAnnouncements(ann.audiences);
  }

  return { pushSent };
}
