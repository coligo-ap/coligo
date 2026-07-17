/**
 * Capture d'événements anti-fraude (mig 0373-0374) — helpers serveur
 * FIRE-AND-FORGET : jamais de throw, aucune erreur ne bloque le flux métier.
 *
 * Philosophie : l'historique métier (orders, rides, messages, refus Express…)
 * reste la source primaire des détecteurs. Ici on ne capture QUE ce qui
 * n'existait pas : annulation contextualisée (position/contact au moment T,
 * via la RPC `fraud_ingest_cancel` qui calcule les flags UNE fois), appels
 * in-app, décisions d'offres, bascules en ligne / hors ligne.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { maybeFraudTick } from "@/lib/fraud/tick";

export type FraudActorKind = "customer" | "driver" | "chauffeur" | "merchant";
export type FraudCancelBy = FraudActorKind | "admin";

type AdminRpc = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

function adminRpc(): AdminRpc {
  const admin = createAdminClient();
  return admin.rpc.bind(admin) as unknown as AdminRpc;
}

/**
 * Ingestion d'une ANNULATION (commande ou course) : la RPC calcule phase,
 * proximité destination et contact récent, écrit un événement par acteur
 * impliqué puis RE-SCORE chacun (alertes + actions automatiques).
 */
export async function fraudIngestCancel(
  context: "order" | "ride",
  id: string,
  by: FraudCancelBy
): Promise<void> {
  try {
    const { error } = await adminRpc()("fraud_ingest_cancel", {
      p_context: context,
      p_id: id,
      p_by: by,
    });
    if (error) console.warn("[fraud] ingest_cancel failed:", error.message);
  } catch (err) {
    console.warn("[fraud] ingest_cancel failed:", err);
  }
  void maybeFraudTick();
}

/** Événement brut dans `fraud_events` (acteur déjà résolu). */
export async function fraudRecordEvent(input: {
  actorKind: FraudActorKind;
  actorId: string;
  userId?: string | null;
  eventType: string;
  orderId?: string | null;
  rideId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("fraud_events").insert({
      actor_kind: input.actorKind,
      actor_id: input.actorId,
      user_id: input.userId ?? null,
      event_type: input.eventType,
      order_id: input.orderId ?? null,
      ride_id: input.rideId ?? null,
      meta: (input.meta ?? {}) as never,
    });
  } catch (err) {
    console.warn("[fraud] record event failed:", err);
  }
}

/** Résout le LIVREUR depuis son user auth (colonnes indexées). */
async function driverByUser(
  userId: string
): Promise<{ id: string; user_id: string | null } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("drivers")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Décision explicite d'un livreur sur une offre Express (accept = pickup,
 * decline = refus) : trace + remise à zéro de la série d'offres ignorées.
 */
export async function fraudNoteOfferDecisionByUser(
  userId: string,
  orderId: string,
  decision: "accept" | "decline"
): Promise<void> {
  try {
    const d = await driverByUser(userId);
    if (!d) return;
    const { error } = await adminRpc()("fraud_note_offer_decision", {
      p_driver: d.id,
      p_order: orderId,
      p_decision: decision,
    });
    if (error) console.warn("[fraud] offer decision failed:", error.message);
  } catch (err) {
    console.warn("[fraud] offer decision failed:", err);
  }
}

/** Événement d'un livreur identifié par son user auth (appel client, etc.). */
export async function fraudDriverEventByUser(
  userId: string,
  eventType: string,
  orderId: string | null,
  meta?: Record<string, unknown>
): Promise<void> {
  const d = await driverByUser(userId);
  if (!d) return;
  await fraudRecordEvent({
    actorKind: "driver",
    actorId: d.id,
    userId: d.user_id,
    eventType,
    orderId,
    meta,
  });
}

/**
 * Appel in-app sur une course Drive : l'APPELANT est l'acteur ; la direction
 * (`meta.from`) sert au détecteur « annulation après appel ».
 */
export async function fraudRecordRideCall(
  rideId: string,
  fromRole: "client" | "chauffeur"
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: ride } = await admin
      .from("rides")
      .select(
        "customer_id, chauffeur_id, customers(user_id), chauffeurs(user_id)"
      )
      .eq("id", rideId)
      .maybeSingle();
    if (!ride) return;
    const cu = ride.customers as unknown as { user_id: string | null } | null;
    const ch = ride.chauffeurs as unknown as { user_id: string | null } | null;
    const from = fromRole === "client" ? "customer" : "chauffeur";
    const actorId = from === "customer" ? ride.customer_id : ride.chauffeur_id;
    if (!actorId) return;
    await fraudRecordEvent({
      actorKind: from,
      actorId,
      userId:
        from === "customer" ? (cu?.user_id ?? null) : (ch?.user_id ?? null),
      eventType: "call_initiated",
      rideId,
      meta: { from },
    });
  } catch (err) {
    console.warn("[fraud] ride call event failed:", err);
  }
}

/**
 * Bascule en ligne / hors ligne d'un CHAUFFEUR (bouton GO) : trace la session
 * (durée, immobilité) pour les détecteurs de présence fantôme, et tient le
 * miroir `fraud_partner_presence`.
 */
export async function fraudChauffeurToggle(
  chauffeurId: string,
  userId: string | null,
  online: boolean
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: pr } = await admin
      .from("fraud_partner_presence")
      .select("is_online, online_since, last_moved_at, last_seen_at")
      .eq("actor_kind", "chauffeur")
      .eq("actor_id", chauffeurId)
      .maybeSingle();

    if (online) {
      await admin.from("fraud_partner_presence").upsert(
        {
          actor_kind: "chauffeur",
          actor_id: chauffeurId,
          user_id: userId,
          is_online: true,
          online_since: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          forced_offline_at: null,
        },
        { onConflict: "actor_kind,actor_id" }
      );
      await fraudRecordEvent({
        actorKind: "chauffeur",
        actorId: chauffeurId,
        userId,
        eventType: "went_online",
      });
      return;
    }

    // Hors ligne volontaire : clôture de session (durée + immobilité)
    const sessionMin =
      pr?.is_online && pr.online_since
        ? Math.max(
            0,
            Math.round(
              (Date.now() - new Date(pr.online_since).getTime()) / 60000
            )
          )
        : null;
    const idle =
      !!pr?.is_online &&
      (!pr.last_moved_at ||
        Date.now() - new Date(pr.last_moved_at).getTime() > 45 * 60000);
    await admin.from("fraud_partner_presence").upsert(
      {
        actor_kind: "chauffeur",
        actor_id: chauffeurId,
        user_id: userId,
        is_online: false,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "actor_kind,actor_id" }
    );
    await fraudRecordEvent({
      actorKind: "chauffeur",
      actorId: chauffeurId,
      userId,
      eventType: "went_offline",
      meta: {
        cause: "toggle",
        ...(sessionMin != null ? { session_min: sessionMin } : {}),
        idle,
      },
    });
  } catch (err) {
    console.warn("[fraud] chauffeur toggle failed:", err);
  }
}
