"use server";

import { getDriveActiveRide } from "@/app/(customer)/drive/actions";
import { getChauffeurActiveRide } from "@/app/(chauffeur)/actions";
import { notifyRideIncomingCall } from "@/lib/fcm/triggers";
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
