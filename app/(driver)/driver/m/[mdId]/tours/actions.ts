"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getDriverGate } from "@/lib/auth/driver-gate";

export type TourActionState = { error?: string; ok?: boolean; tourId?: string };

const START_TOUR_ERRORS: Record<string, string> = {
  link_not_active: "Accès refusé.",
  unauthorized: "Accès refusé.",
  account_not_verified:
    "Votre compte doit d'abord être vérifié par l'équipe Coligo.",
  slot_not_found: "Créneau introuvable.",
  slot_cancelled: "Ce créneau est annulé.",
  merchant_position_missing: "Position commerçant manquante.",
  no_orders: "Aucune commande à livrer sur ce créneau.",
};

/**
 * Démarre une tournée pour un créneau donné via le RPC `start_tour` (0164) :
 * vérifs d'autorisation, claim atomique des commandes non attribuées
 * (anti-course entre deux livreurs du même commerçant), ordre optimisé par
 * proximité et attribution `delivery_driver_id` — le tout côté SQL en
 * SECURITY DEFINER (le client livreur n'a pas le droit d'UPDATE `orders`).
 */
export async function startTour(
  merchantDriverId: string,
  slotId: string
): Promise<TourActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée." };

  // Compte non activé → aucune tournée. Le RPC `start_tour` (mig 0352) refuse
  // aussi ce cas : la garde ne fait qu'expliciter le message.
  const gate = await getDriverGate();
  if (!gate || gate.stage !== "active" || gate.isBlocked) {
    return { error: START_TOUR_ERRORS.account_not_verified };
  }

  // Cast localisé : start_tour (0164) pas encore dans database.types.ts généré
  // (Docker requis pour gen types).
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  ).call(supabase, "start_tour", {
    p_merchant_driver_id: merchantDriverId,
    p_slot_id: slotId,
  });
  if (error) return { error: error.message };

  const rows = data as Array<{
    ok: boolean;
    reason: string | null;
    tour_id: string | null;
    stops_count: number | null;
  }> | null;
  const row = rows?.[0] ?? null;
  if (!row?.ok || !row.tour_id) {
    return {
      error:
        START_TOUR_ERRORS[row?.reason ?? ""] ??
        "Échec du démarrage de la tournée.",
    };
  }

  revalidatePath(`/driver/m/${merchantDriverId}`);
  return { ok: true, tourId: row.tour_id };
}
