"use server";

import { getDriveActiveRide } from "@/app/(customer)/drive/actions";
import { getChauffeurActiveRide } from "@/app/(chauffeur)/actions";
import { getAuthUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  notifyOrderIncomingCall,
  notifyRideIncomingCall,
} from "@/lib/fcm/triggers";
import { fraudRecordRideCall } from "@/lib/fraud/events";

/**
 * Fait sonner le pair (push FCM) lors d'un appel in-app Drive, pour qu'il soit
 * réveillé même app fermée / en arrière-plan. Fire-and-forget.
 *
 * Sécurité : on ne notifie QUE si la course active de l'appelant correspond au
 * `rideId` (réutilise les helpers RLS-aware, comme la route de jeton Agora).
 */
export async function ringRidePeer(input: {
  rideId: string;
  role: "client" | "chauffeur";
}): Promise<void> {
  const ride =
    input.role === "client"
      ? await getDriveActiveRide()
      : await getChauffeurActiveRide();
  if (!ride || ride.id !== input.rideId) return;
  await notifyRideIncomingCall({ rideId: input.rideId, fromRole: input.role });
  // Anti-fraude : appel tracé (détecteur « annulation après appel »)
  void fraudRecordRideCall(input.rideId, input.role);
}

/** Statuts pendant lesquels un appel commerçant → client a du sens. */
const ORDER_CALL_STATUSES = ["pending", "accepted", "preparing", "ready"];

/**
 * Fait sonner le CLIENT d'une commande (appel in-app commerçant → client,
 * SENS UNIQUE — le client ne peut pas faire sonner le commerçant : aucune
 * action équivalente n'existe côté client, et celle-ci exige une session
 * COMMERÇANT propriétaire de la commande).
 */
export async function ringOrderCustomer(input: {
  orderId: string;
}): Promise<{ ok: boolean }> {
  const user = await getAuthUser();
  if (!user) return { ok: false };
  const supabase = await createClient();
  const { data: me } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me) return { ok: false };
  // Scope explicite merchant_id (règle projet) en plus de la RLS.
  const { data: order } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", input.orderId)
    .eq("merchant_id", me.id)
    .maybeSingle();
  if (!order || !ORDER_CALL_STATUSES.includes(order.status)) {
    return { ok: false };
  }
  await notifyOrderIncomingCall({ orderId: input.orderId });
  return { ok: true };
}
