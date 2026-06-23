// =============================================================================
// Course active du client (my_active_ride) — module DATA pur (PAS « use server »)
// pour être appelé AUSSI BIEN par le SSR (page /drive) que par l'action client.
// Inclut l'auto-annulation des recherches expirées (deadline, mig 0250).
//
// `skipAvatar` : au SSR on N'A PAS besoin de signer l'avatar du chauffeur
// (coûteux : appel storage). On le saute → page instantanée ; le refresh client
// (getDriveActiveRide complet) remplit l'avatar ensuite.
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { chauffeurAvatarUrls } from "@/lib/drive/avatar-server";

export type DriveActiveRide = {
  id: string;
  status: string;
  pickup_text: string | null;
  dest_text: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dest_lat: number | null;
  dest_lng: number | null;
  distance_km: number;
  proposed_price_da: number;
  agreed_price_da: number | null;
  boost_amount_da: number;
  gamme: string;
  payment_method: string;
  female_only: boolean;
  proxy_name: string | null;
  proxy_phone: string | null;
  share_token: string | null;
  end_code: string | null;
  online_paid: boolean;
  /** Séquestre Coligo Pay réservé (DA) — mig 0163. */
  escrow_da: number;
  /** Complément à régler EN ESPÈCES au chauffeur (Coligo Pay partiel). */
  cash_due_da: number;
  /** Échéance de la recherche (auto-annulation si personne ne répond) — mig 0250. */
  expires_at: string | null;
  chauffeur: {
    id: string;
    name: string;
    avatar_url: string | null;
    vehicle: string | null;
    plate: string | null;
    phone: string | null;
    rating: number | null;
    rides: number;
    is_female: boolean;
    is_premium: boolean;
    is_favorite: boolean;
    lat: number | null;
    lng: number | null;
  } | null;
};

export async function getActiveRideFor(opts?: {
  skipAvatar?: boolean;
}): Promise<DriveActiveRide | null> {
  const supabase = await createClient();
  // ⚠️ Toujours .bind(supabase) — extraire rpc sans bind casse this.rest.
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;

  // Deadline : on annule d'abord les recherches expirées sans réponse (mig 0250)
  // → une demande à laquelle personne n'a répondu repasse en 'cancelled' et
  // n'apparaît plus comme « en recherche ». Best-effort.
  await rpc("drive_expire_stale_searches", {}).catch(() => undefined);
  const { data } = await rpc("my_active_ride", {});
  const r = (Array.isArray(data) ? data[0] : null) as Record<
    string,
    unknown
  > | null;
  if (!r) return null;

  let avatarUrl: string | null = null;
  if (r.ch_name && r.chauffeur_id && !opts?.skipAvatar) {
    avatarUrl =
      (await chauffeurAvatarUrls([r.chauffeur_id as string])).get(
        r.chauffeur_id as string
      ) ?? null;
  }

  return {
    id: r.id as string,
    status: r.status as string,
    pickup_text: (r.pickup_text as string) ?? null,
    dest_text: (r.dest_text as string) ?? null,
    pickup_lat: (r.pickup_lat as number) ?? null,
    pickup_lng: (r.pickup_lng as number) ?? null,
    dest_lat: (r.dest_lat as number) ?? null,
    dest_lng: (r.dest_lng as number) ?? null,
    distance_km: Number(r.distance_km ?? 0),
    proposed_price_da: (r.proposed_price_da as number) ?? 0,
    agreed_price_da: (r.agreed_price_da as number) ?? null,
    boost_amount_da: (r.boost_amount_da as number) ?? 0,
    gamme: (r.gamme as string) ?? "classic",
    payment_method: (r.payment_method as string) ?? "cash",
    female_only: Boolean(r.female_only),
    proxy_name: (r.proxy_name as string) ?? null,
    proxy_phone: (r.proxy_phone as string) ?? null,
    share_token: (r.share_token as string) ?? null,
    end_code: (r.end_code as string) ?? null,
    online_paid: r.online_paid_at != null,
    escrow_da: (r.escrow_da as number) ?? 0,
    cash_due_da: (r.cash_due_da as number) ?? 0,
    expires_at: (r.expires_at as string) ?? null,
    chauffeur: r.ch_name
      ? {
          id: r.chauffeur_id as string,
          name: r.ch_name as string,
          avatar_url: avatarUrl,
          vehicle: (r.ch_vehicle as string) ?? null,
          plate: (r.ch_plate as string) ?? null,
          phone: (r.ch_phone as string) ?? null,
          rating: r.ch_rating == null ? null : Number(r.ch_rating),
          rides: Number(r.ch_rides ?? 0),
          is_female: Boolean(r.ch_is_female),
          is_premium: Boolean(r.ch_is_premium),
          is_favorite: Boolean(r.ch_is_favorite),
          lat: (r.ch_lat as number) ?? null,
          lng: (r.ch_lng as number) ?? null,
        }
      : null,
  };
}
