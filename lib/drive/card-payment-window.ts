// =============================================================================
// Fenêtre de paiement CARTE d'une course Drive — balayage des expirations
// =============================================================================
// Modèle « payer à l'acceptation » (mig 0386) : choisir un chauffeur RÉSERVE
// son offre 3 min, le temps de payer. Si le client ne paie pas, la course est
// annulée et le chauffeur doit être LIBÉRÉ **et prévenu** — sinon il reste
// bloqué sans comprendre pourquoi (mig 0393).
//
// Pourquoi un balayage et pas un cron : Vercel ne descend pas sous la journée
// pour les crons de ce projet (vercel.json), alors que la fenêtre est de
// 3 min. On suit donc le pattern déjà en place pour `drive_expire_stale_searches` :
// appel FIRE-AND-FORGET depuis les ticks qui tournent déjà en continu (tick
// chauffeur + poll de course côté client). La fonction SQL est idempotente,
// sans paramètre et ne traite que des lignes objectivement périmées : deux
// appels simultanés ne peuvent ni annuler deux fois ni viser la course d'un
// tiers.
// =============================================================================

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { storeAndPushNotification } from "@/lib/notifications/notify";

type ExpiredRow = {
  ride_id: string;
  chauffeur_id: string | null;
  offer_id: string;
  customer_id: string | null;
  price_da: number;
};

/**
 * Expire les fenêtres de paiement dépassées, puis prévient les deux parties.
 * Ne throw JAMAIS (appelée en fire-and-forget depuis des chemins chauds).
 * @returns le nombre de courses annulées pour non-paiement.
 */
export async function sweepExpiredCardPayments(): Promise<number> {
  try {
    const admin = createAdminClient();
    // ⚠️ `.bind` obligatoire (le rpc détaché perd son `this`) et JAMAIS `.catch`
    // sur le builder Supabase : il n'en a pas, l'appel throw.
    const rpc = admin.rpc.bind(admin) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc("drive_card_expire_payments", {});
    if (error) {
      console.error("[drive-card] balayage échoué:", error.message);
      return 0;
    }
    const rows = (Array.isArray(data) ? data : []) as ExpiredRow[];
    if (rows.length === 0) return 0;

    for (const row of rows) {
      // Chauffeur : il était réservé (donc indisponible) — on lui dit
      // explicitement qu'il est de nouveau libre, pour qu'il ne reste pas en
      // attente d'une course qui n'existe plus.
      if (row.chauffeur_id) {
        const { data: ch } = await admin
          .from("chauffeurs")
          .select("user_id")
          .eq("id", row.chauffeur_id)
          .maybeSingle();
        if (ch?.user_id) {
          await storeAndPushNotification({
            userId: ch.user_id,
            audience: "chauffeur",
            kind: "ride_payment_timeout",
            title: "Course annulée",
            body: "Le client n'a pas payé dans le délai. Vous êtes de nouveau disponible.",
            route: "/chauffeur/demandes",
          });
        }
      }
      // Client : il a pu quitter l'app pendant le paiement — sans ce message,
      // il retrouverait sa course « disparue » sans explication.
      if (row.customer_id) {
        const { data: cust } = await admin
          .from("customers")
          .select("user_id")
          .eq("id", row.customer_id)
          .maybeSingle();
        if (cust?.user_id) {
          await storeAndPushNotification({
            userId: cust.user_id,
            audience: "customer",
            kind: "ride_payment_timeout",
            title: "Course annulée",
            body: "Le paiement n'a pas été finalisé à temps. Vous pouvez relancer une demande.",
            route: "/drive",
          });
        }
      }
    }
    return rows.length;
  } catch (err) {
    console.warn("[drive-card] balayage: exception ignorée:", err);
    return 0;
  }
}
