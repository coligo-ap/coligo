/**
 * Notifications persistées (table `user_notifications`, mig 0363) + push FCM.
 *
 * Même philosophie que `pushAndStoreForDriver` (livreur) : la trace interne
 * survit à un push manqué — l'utilisateur retrouve l'événement dans sa cloche,
 * et le badge se met à jour SANS rechargement (Realtime INSERT sur la table).
 *
 * Tous les helpers sont fire-and-forget : jamais de throw, les erreurs
 * n'arrêtent pas le flux applicatif.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { formatDA } from "@/lib/utils";
import { sendFcm } from "@/lib/fcm/send";

export type NotifAudience = "customer" | "chauffeur" | "driver" | "merchant";

/** Rôle `device_tokens` correspondant à chaque audience de notification. */
const FCM_ROLE: Record<
  NotifAudience,
  "customer" | "chauffeur" | "courier" | "merchant"
> = {
  customer: "customer",
  chauffeur: "chauffeur",
  driver: "courier",
  merchant: "merchant",
};

/**
 * Insère la notification (centre in-app, badge temps réel) et double d'un push
 * FCM si l'utilisateur a des appareils enregistrés. Fire-and-forget.
 */
export async function storeAndPushNotification(input: {
  userId: string;
  audience: NotifAudience;
  kind: string;
  title: string;
  body: string;
  route?: string;
  /** false = trace in-app seule (événement déjà poussé par un autre canal). */
  push?: boolean;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("user_notifications").insert({
      user_id: input.userId,
      audience: input.audience,
      kind: input.kind,
      title: input.title,
      body: input.body,
      route: input.route ?? null,
    });
    if (input.push === false) return;
    const { data } = await admin
      .from("device_tokens")
      .select("token")
      .eq("user_id", input.userId)
      .eq("role", FCM_ROLE[input.audience]);
    const tokens = (data ?? []).map((r) => r.token).filter(Boolean);
    if (tokens.length === 0) return;
    await sendFcm(
      tokens,
      { title: input.title, body: input.body },
      { route: input.route ?? "/", kind: input.kind }
    );
  } catch (err) {
    console.warn("[notif] storeAndPushNotification failed:", err);
  }
}

type RideParties = {
  customerUserId: string | null;
  customerName: string;
  chauffeurUserId: string | null;
  chauffeurName: string;
  priceDa: number;
  cashbackDa: number;
};

async function rideParties(rideId: string): Promise<RideParties | null> {
  const admin = createAdminClient();
  const { data: ride } = await admin
    .from("rides")
    .select(
      "customer_id, chauffeur_id, agreed_price_da, proposed_price_da, boost_amount_da, cashback_da, customers(user_id, first_name, full_name), chauffeurs(user_id, first_name, full_name)"
    )
    .eq("id", rideId)
    .maybeSingle();
  if (!ride) return null;
  const cu = ride.customers as unknown as {
    user_id: string | null;
    first_name: string | null;
    full_name: string;
  } | null;
  const ch = ride.chauffeurs as unknown as {
    user_id: string | null;
    first_name: string | null;
    full_name: string;
  } | null;
  return {
    customerUserId: cu?.user_id ?? null,
    customerName: cu ? (cu.first_name ?? cu.full_name.split(" ")[0]) : "Client",
    chauffeurUserId: ch?.user_id ?? null,
    chauffeurName: ch
      ? (ch.first_name ?? ch.full_name.split(" ")[0])
      : "Votre chauffeur",
    priceDa:
      ride.agreed_price_da ??
      (ride.proposed_price_da ?? 0) + (ride.boost_amount_da ?? 0),
    cashbackDa: ride.cashback_da ?? 0,
  };
}

export type RideNotifKind =
  | "ride_accepted"
  | "ride_arriving"
  | "ride_arrived"
  | "ride_started"
  | "ride_completed"
  | "ride_cancelled_by_customer"
  | "ride_cancelled_by_chauffeur"
  | "ride_tip";

/**
 * Notification du cycle de vie d'une course Drive — résout la cible (client ou
 * chauffeur selon l'événement), stocke + pousse. Fire-and-forget.
 */
export async function notifyRideEvent(
  rideId: string,
  kind: RideNotifKind,
  extra?: { amountDa?: number }
): Promise<void> {
  try {
    const p = await rideParties(rideId);
    if (!p) return;

    switch (kind) {
      case "ride_accepted":
        if (!p.chauffeurUserId) return;
        return storeAndPushNotification({
          userId: p.chauffeurUserId,
          audience: "chauffeur",
          kind,
          title: "Course confirmée ✓",
          body: `${p.customerName} vous attend · ${formatDA(p.priceDa)}. Direction le point de départ.`,
          route: "/chauffeur/course",
        });
      case "ride_arriving":
        if (!p.customerUserId) return;
        return storeAndPushNotification({
          userId: p.customerUserId,
          audience: "customer",
          kind,
          title: `${p.chauffeurName} est en route`,
          body: "Suivez son arrivée en direct sur la carte.",
          route: "/drive",
        });
      case "ride_arrived":
        if (!p.customerUserId) return;
        return storeAndPushNotification({
          userId: p.customerUserId,
          audience: "customer",
          kind,
          title: `${p.chauffeurName} est arrivé`,
          body: "Votre chauffeur vous attend au point de départ.",
          route: "/drive",
        });
      case "ride_started":
        if (!p.customerUserId) return;
        return storeAndPushNotification({
          userId: p.customerUserId,
          audience: "customer",
          kind,
          title: "Course démarrée",
          body: "Bonne route ! Suivez le trajet en direct.",
          route: "/drive",
          push: false,
        });
      case "ride_completed":
        if (!p.customerUserId) return;
        return storeAndPushNotification({
          userId: p.customerUserId,
          audience: "customer",
          kind,
          title: "Course terminée",
          body:
            `${formatDA(p.priceDa)}` +
            (p.cashbackDa > 0
              ? ` · +${p.cashbackDa} DA de cashback`
              : " · merci d'avoir voyagé avec Coligo"),
          route: "/drive",
        });
      case "ride_cancelled_by_customer":
        if (!p.chauffeurUserId) return;
        return storeAndPushNotification({
          userId: p.chauffeurUserId,
          audience: "chauffeur",
          kind,
          title: "Course annulée",
          body: `${p.customerName} a annulé la course. Aucun frais — les demandes continuent.`,
          route: "/chauffeur/demandes",
        });
      case "ride_cancelled_by_chauffeur":
        if (!p.customerUserId) return;
        return storeAndPushNotification({
          userId: p.customerUserId,
          audience: "customer",
          kind,
          title: "Course annulée par le chauffeur",
          body: "Relancez une demande — d'autres chauffeurs sont disponibles.",
          route: "/drive",
        });
      case "ride_tip":
        if (!p.chauffeurUserId) return;
        return storeAndPushNotification({
          userId: p.chauffeurUserId,
          audience: "chauffeur",
          kind,
          title: `Pourboire reçu · +${formatDA(extra?.amountDa ?? 0)}`,
          body: `${p.customerName} vous a laissé un pourboire. Bien joué !`,
          route: "/chauffeur/gains",
        });
    }
  } catch (err) {
    console.warn("[notif] notifyRideEvent failed:", err);
  }
}
