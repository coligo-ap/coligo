"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chauffeurAvatarUrls } from "@/lib/drive/avatar-server";
import { notifyChauffeursNewRide } from "@/lib/fcm/triggers";

type Rpc = (
  fn: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;
async function rpcClient(): Promise<Rpc> {
  const supabase = await createClient();
  // ⚠️ Toujours .bind(supabase) — extraire rpc sans bind casse this.rest.
  return supabase.rpc.bind(supabase) as unknown as Rpc;
}

/**
 * Répondeur DÉMO : les chauffeurs de démonstration (is_demo) font des offres
 * automatiques pour rendre tout le parcours testable (mig 0147). Best-effort.
 */
async function triggerDemoResponder(rideId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const rpc = admin.rpc.bind(admin) as unknown as Rpc;
    await rpc("drive_demo_respond", { p_ride_id: rideId });
  } catch {
    /* démo uniquement — ne bloque jamais */
  }
}

/* ─────────────────────────── Contexte Drive ─────────────────────────── */

export type DriveContext = {
  priceStep: number;
  boostMin: number;
  boostStep: number;
  boostDefaultRate: number;
  femaleFilterEnabled: boolean;
  isFemaleVerified: boolean;
  femaleOnlineCount: number;
  deviationKm: number;
  deviationMin: number;
  /** Solde Coligo Pay (DA) — affiché sur le moyen de paiement (mig 0163). */
  walletBalance: number;
  recents: { text: string; lat: number; lng: number }[];
  lastRide: {
    dest_text: string | null;
    chauffeur_name: string | null;
    price_da: number | null;
    completed: boolean;
    when: string;
  } | null;
};

export async function getDriveContext(): Promise<DriveContext> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: settings }, { data: cust }] = await Promise.all([
    admin
      .from("platform_settings")
      .select(
        "drive_price_step_da, drive_boost_min_da, drive_boost_step_da, drive_boost_default_rate, drive_female_filter_enabled, drive_deviation_km, drive_deviation_min"
      )
      .eq("id", true)
      .maybeSingle(),
    user
      ? supabase
          .from("customers")
          .select("id, is_female_verified")
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Solde Coligo Pay : montré sur le chip de paiement ; un solde partiel
  // est accepté (séquestre partiel + complément espèces, mig 0163).
  let walletBalance = 0;
  if (cust?.id) {
    const { data: bal } = await supabase.rpc("customer_topup_balance", {
      p_customer_id: cust.id,
    });
    walletBalance = typeof bal === "number" ? bal : 0;
  }

  // Conductrices en ligne (compteur affiché sur l'option rose).
  let femaleOnline = 0;
  if (settings?.drive_female_filter_enabled && cust?.is_female_verified) {
    const { count } = await admin
      .from("chauffeur_presence")
      .select(
        "chauffeur_id, chauffeurs!inner(is_female_verified, is_verified, is_frozen, is_blocked)",
        {
          count: "exact",
          head: true,
        }
      )
      .eq("is_online", true)
      .gte("updated_at", new Date(Date.now() - 3 * 60_000).toISOString())
      .eq("chauffeurs.is_female_verified", true)
      .eq("chauffeurs.is_verified", true)
      .eq("chauffeurs.is_frozen", false)
      .eq("chauffeurs.is_blocked", false);
    femaleOnline = count ?? 0;
  }

  // Destinations récentes + dernière course (raccourcis de l'accueil).
  const recents: DriveContext["recents"] = [];
  let lastRide: DriveContext["lastRide"] = null;
  if (cust?.id) {
    const { data: rides } = await admin
      .from("rides")
      .select(
        "dest_text, dest_lat, dest_lng, status, agreed_price_da, proposed_price_da, created_at, chauffeurs(first_name, full_name)"
      )
      .eq("customer_id", cust.id)
      .in("status", ["completed", "cancelled"])
      .order("created_at", { ascending: false })
      .limit(12);
    const seen = new Set<string>();
    for (const r of rides ?? []) {
      if (!r.dest_text || r.dest_lat == null || seen.has(r.dest_text)) continue;
      seen.add(r.dest_text);
      recents.push({ text: r.dest_text, lat: r.dest_lat, lng: r.dest_lng! });
      if (recents.length >= 2) break;
    }
    // Raccourci « dernière course » : on ignore les demandes annulées sans
    // chauffeur attribué (recherche abandonnée — pas une vraie course).
    const last = (rides ?? []).find(
      (r) => r.status === "completed" || r.chauffeurs != null
    );
    if (last) {
      const ch = last.chauffeurs as unknown as {
        first_name: string | null;
        full_name: string;
      } | null;
      lastRide = {
        dest_text: last.dest_text,
        chauffeur_name: ch
          ? (ch.first_name ?? ch.full_name.split(" ")[0])
          : null,
        price_da: last.agreed_price_da ?? last.proposed_price_da,
        completed: last.status === "completed",
        when: last.created_at,
      };
    }
  }

  return {
    priceStep: settings?.drive_price_step_da ?? 20,
    boostMin: settings?.drive_boost_min_da ?? 10,
    boostStep: settings?.drive_boost_step_da ?? 5,
    boostDefaultRate: Number(settings?.drive_boost_default_rate ?? 0.1),
    femaleFilterEnabled: settings?.drive_female_filter_enabled ?? false,
    isFemaleVerified: cust?.is_female_verified ?? false,
    femaleOnlineCount: femaleOnline,
    deviationKm: Number(settings?.drive_deviation_km ?? 1.2),
    deviationMin: settings?.drive_deviation_min ?? 2,
    walletBalance,
    recents,
    lastRide,
  };
}

/* ─────────────────────────── Devis par gamme ─────────────────────────── */

export type DriveQuote = {
  recommended: number;
  floor: number;
  /** Prix mini conseillé (très attractif, moins de chauffeurs). */
  mini: number;
  /** Prix « rapide » (propositions plus vite). */
  fast: number;
  low: number;
  high: number;
};

/**
 * Devis intelligent (mig 0149) : mini / recommandé / rapide — barème +
 * temps + heure de pointe + demande/offre locale + apprentissage des prix
 * réellement acceptés, puis remise de lancement (5–12 %).
 */
export async function getDriveQuotes(
  distanceKm: number,
  pickup?: { lat: number; lng: number } | null
): Promise<Record<"classic" | "confort" | "moto", DriveQuote>> {
  const rpc = await rpcClient();
  const gammes = ["classic", "confort", "moto"] as const;
  const out = {} as Record<(typeof gammes)[number], DriveQuote>;
  await Promise.all(
    gammes.map(async (g) => {
      const [smart, range] = await Promise.all([
        rpc("drive_smart_quote", {
          p_distance_km: distanceKm,
          p_gamme: g,
          p_pickup_lat: pickup?.lat ?? null,
          p_pickup_lng: pickup?.lng ?? null,
        }),
        rpc("drive_similar_range", { p_distance_km: distanceKm, p_gamme: g }),
      ]);
      const q = (Array.isArray(smart.data) ? smart.data[0] : null) as {
        floor_da: number;
        mini_da: number;
        reco_da: number;
        fast_da: number;
      } | null;
      const r = (Array.isArray(range.data) ? range.data[0] : null) as {
        low_da: number;
        high_da: number;
      } | null;
      out[g] = {
        recommended: q?.reco_da ?? 0,
        floor: q?.floor_da ?? 0,
        mini: q?.mini_da ?? 0,
        fast: q?.fast_da ?? 0,
        low: r?.low_da ?? 0,
        high: r?.high_da ?? 0,
      };
    })
  );
  return out;
}

/* ─────────────────────────── Demande de course ─────────────────────────── */

export async function requestDriveRide(input: {
  pickup_lat: number;
  pickup_lng: number;
  pickup_text?: string | null;
  dest_lat: number;
  dest_lng: number;
  dest_text?: string | null;
  distance_km: number;
  proposed_price_da: number;
  payment_method: "cash" | "card" | "coligo_pay";
  gamme: "classic" | "confort" | "moto";
  boost_da: number;
  female_only: boolean;
  proxy_name?: string | null;
  proxy_phone?: string | null;
  operation_id?: string | null;
}): Promise<{ ok: boolean; rideId?: string; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("request_ride", {
    p_pickup_lat: input.pickup_lat,
    p_pickup_lng: input.pickup_lng,
    p_pickup_text: input.pickup_text ?? null,
    p_dest_lat: input.dest_lat,
    p_dest_lng: input.dest_lng,
    p_dest_text: input.dest_text ?? null,
    p_distance_km: input.distance_km,
    p_proposed_price: Math.max(0, Math.floor(input.proposed_price_da)),
    p_payment_method: input.payment_method,
    p_gamme: input.gamme,
    p_boost_da: Math.max(0, Math.floor(input.boost_da)),
    p_female_only: input.female_only,
    p_proxy_name: input.proxy_name ?? null,
    p_proxy_phone: input.proxy_phone ?? null,
    p_operation_id: input.operation_id ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const rideId = typeof data === "string" ? data : undefined;
  if (rideId) {
    void notifyChauffeursNewRide({ rideId });
    void triggerDemoResponder(rideId);
  }
  return { ok: true, rideId };
}

export async function boostRide(
  rideId: string,
  boostDa: number
): Promise<{ ok: boolean; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("ride_boost", {
    p_ride_id: rideId,
    p_boost_da: Math.max(0, Math.floor(boostDa)),
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  if (row?.ok) {
    // Relance la diffusion en priorité (badge ⚡ côté chauffeur).
    void notifyChauffeursNewRide({ rideId });
    void triggerDemoResponder(rideId);
    return { ok: true };
  }
  return { ok: false, error: row?.reason };
}

/* ─────────────────────────── Offres ─────────────────────────── */

export type DriveOffer = {
  id: string;
  price_da: number;
  chauffeur_id: string;
  name: string;
  /** Photo de visage (selfie), URL signée — null si pas de photo. */
  avatar_url: string | null;
  vehicle: string | null;
  plate: string | null;
  rating: number | null;
  rides_count: number;
  is_female: boolean;
  is_premium: boolean;
  is_favorite: boolean;
  eta_km: number | null;
  eta_min: number | null;
  /** Score de classement intelligent (mig 0149) — tri « Recommandés ». */
  rank_score: number;
};

export async function getDriveOffers(rideId: string): Promise<DriveOffer[]> {
  const rpc = await rpcClient();
  const { data } = await rpc("my_ride_offers", { p_ride_id: rideId });
  const rows = (data as Record<string, unknown>[] | null) ?? [];
  const avatars = await chauffeurAvatarUrls(
    rows.map((o) => o.chauffeur_id as string)
  );
  return rows.map((o) => {
    const etaKm = o.eta_km == null ? null : Number(o.eta_km);
    return {
      id: o.id as string,
      price_da: o.price_da as number,
      chauffeur_id: o.chauffeur_id as string,
      name: (o.chauffeur_name as string) ?? "Chauffeur",
      avatar_url: avatars.get(o.chauffeur_id as string) ?? null,
      vehicle: (o.vehicle as string) ?? null,
      plate: (o.plate as string) ?? null,
      rating: o.rating == null ? null : Number(o.rating),
      rides_count: Number(o.rides_count ?? 0),
      is_female: Boolean(o.is_female),
      is_premium: Boolean(o.is_premium),
      is_favorite: Boolean(o.is_favorite),
      eta_km: etaKm,
      eta_min:
        etaKm == null ? null : Math.max(1, Math.round((etaKm / 25) * 60)),
      rank_score: Number(o.rank_score ?? 0),
    };
  });
}

export async function acceptDriveOffer(
  offerId: string,
  operationId?: string
): Promise<{ ok: boolean; rideId?: string; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("accept_ride_offer", {
    p_offer_id: offerId,
    p_operation_id: operationId ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
    ride_id?: string;
  };
  return row?.ok
    ? { ok: true, rideId: row.ride_id }
    : { ok: false, error: row?.reason };
}

export async function cancelDriveRide(
  rideId: string,
  reason: string | null
): Promise<{ ok: boolean; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("cancel_ride", {
    p_ride_id: rideId,
    p_reason: reason,
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  return row?.ok ? { ok: true } : { ok: false, error: row?.reason };
}

/* ─────────────────────────── Course active ─────────────────────────── */

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

export async function getDriveActiveRide(): Promise<DriveActiveRide | null> {
  const rpc = await rpcClient();
  const { data } = await rpc("my_active_ride", {});
  const r = (Array.isArray(data) ? data[0] : null) as Record<
    string,
    unknown
  > | null;
  if (!r) return null;
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
    chauffeur: r.ch_name
      ? {
          id: r.chauffeur_id as string,
          name: r.ch_name as string,
          avatar_url:
            (await chauffeurAvatarUrls([r.chauffeur_id as string])).get(
              r.chauffeur_id as string
            ) ?? null,
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

/* ───────────────────── Fin de course (dernière terminée) ───────────────────── */

export type DriveLastRide = {
  id: string;
  status: string;
  pickup_text: string | null;
  dest_text: string | null;
  price_da: number;
  payment_method: string;
  /** Complément réglé en espèces (Coligo Pay partiel, mig 0163). */
  cash_due_da: number;
  commission_rate: number | null;
  cashback_da: number;
  my_rating: number | null;
  cancelled_reason: string | null;
  chauffeur: {
    id: string;
    name: string;
    avatar_url: string | null;
    is_favorite: boolean;
  } | null;
} | null;

/** Dernière course TERMINÉE ou ANNULÉE récemment (écran fin de course). */
export async function getDriveLastRide(sinceMin = 30): Promise<DriveLastRide> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: cust } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!cust) return null;
  const since = new Date(Date.now() - sinceMin * 60_000).toISOString();
  const { data: r } = await admin
    .from("rides")
    .select(
      "id, status, pickup_text, dest_text, agreed_price_da, proposed_price_da, boost_amount_da, payment_method, cash_due_da, commission_rate_applied, cashback_da, chauffeur_rating, chauffeur_id, completed_at, cancelled_at, chauffeurs(first_name, full_name)"
    )
    .eq("customer_id", cust.id)
    .in("status", ["completed", "cancelled"])
    .or(`completed_at.gte.${since},cancelled_at.gte.${since}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!r) return null;
  let isFav = false;
  if (r.chauffeur_id) {
    const { data: fav } = await supabase
      .from("customer_favorite_chauffeurs")
      .select("chauffeur_id")
      .eq("customer_id", cust.id)
      .eq("chauffeur_id", r.chauffeur_id)
      .maybeSingle();
    isFav = !!fav;
  }
  const ch = r.chauffeurs as unknown as {
    first_name: string | null;
    full_name: string;
  } | null;
  return {
    id: r.id,
    status: r.status,
    pickup_text: r.pickup_text,
    dest_text: r.dest_text,
    price_da:
      r.agreed_price_da ??
      (r.proposed_price_da ?? 0) + (r.boost_amount_da ?? 0),
    payment_method: r.payment_method,
    cash_due_da: r.cash_due_da ?? 0,
    commission_rate:
      r.commission_rate_applied == null
        ? null
        : Number(r.commission_rate_applied),
    cashback_da: r.cashback_da ?? 0,
    my_rating: r.chauffeur_rating ?? null,
    cancelled_reason: null,
    chauffeur:
      r.chauffeur_id && ch
        ? {
            id: r.chauffeur_id,
            name: ch.first_name ?? ch.full_name.split(" ")[0],
            avatar_url:
              (await chauffeurAvatarUrls([r.chauffeur_id])).get(
                r.chauffeur_id
              ) ?? null,
            is_favorite: isFav,
          }
        : null,
  };
}

export async function rateDriveRide(
  rideId: string,
  rating: number
): Promise<{ ok: boolean; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("rate_ride", {
    p_ride_id: rideId,
    p_rating: rating,
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  return row?.ok ? { ok: true } : { ok: false, error: row?.reason };
}

export async function reportDriveRide(
  rideId: string,
  reason: string
): Promise<{ ok: boolean; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("report_ride", {
    p_ride_id: rideId,
    p_reason: reason,
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  return row?.ok ? { ok: true } : { ok: false, error: row?.reason };
}

export async function sosDriveRide(input: {
  rideId: string;
  kind: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<{ ok: boolean }> {
  const rpc = await rpcClient();
  await rpc("ride_sos", {
    p_ride_id: input.rideId,
    p_kind: input.kind,
    p_lat: input.lat ?? null,
    p_lng: input.lng ?? null,
  });
  return { ok: true };
}

/* ──────────────────── Paiement carte (Chargily) ──────────────────── */

/**
 * Course payée par CARTE : crée le checkout Chargily sur le prix convenu
 * (après attribution). Le webhook seul fait foi (`online_paid_at`).
 */
export async function createRideCardCheckout(
  rideId: string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };
  const { data: cust } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!cust) return { ok: false, error: "no_customer" };

  const { data: ride } = await admin
    .from("rides")
    .select(
      "id, customer_id, status, payment_method, agreed_price_da, proposed_price_da, boost_amount_da, online_paid_at"
    )
    .eq("id", rideId)
    .maybeSingle();
  if (!ride || ride.customer_id !== cust.id)
    return { ok: false, error: "not_your_ride" };
  if (ride.payment_method !== "card") return { ok: false, error: "not_card" };
  if (ride.online_paid_at) return { ok: false, error: "already_paid" };
  // Paiement AVANT diffusion (mig 0145) : montant = prix proposé + boost
  // (prix FIXE côté chauffeurs, pas de contre-offre sur une course carte).
  const amount =
    ride.agreed_price_da ??
    (ride.proposed_price_da ?? 0) + (ride.boost_amount_da ?? 0);
  if (!amount || amount <= 0) return { ok: false, error: "no_amount" };

  try {
    const { createCheckout } = await import("@/lib/payments/chargily");
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
    if (!base) return { ok: false, error: "app_url_missing" };
    const checkout = await createCheckout({
      amount,
      successUrl: `${base}/drive?card=success`,
      failureUrl: `${base}/drive?card=failed`,
      webhookEndpoint: `${base}/api/chargily/webhook`,
      metadata: { type: "ride", ride_id: ride.id },
      description: "Course Coligo Drive",
      locale: "fr",
    });
    await admin
      .from("rides")
      .update({ chargily_checkout_id: checkout.id })
      .eq("id", ride.id);
    return { ok: true, url: checkout.checkout_url };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "chargily_error",
    };
  }
}

/**
 * État du paiement carte d'une course (sondé pendant « En attente du paiement
 * carte… ») : failed = checkout Chargily échoué/abandonné → la demande a été
 * annulée automatiquement (webhook, mig 0163) et le client est ramené à
 * l'écran de choix de gamme avec un message inline.
 */
export async function getRideCardState(rideId: string): Promise<{
  paid: boolean;
  failed: boolean;
  cancelled: boolean;
} | null> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: cust } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!cust) return null;
  const { data: r } = await admin
    .from("rides")
    .select("customer_id, status, online_paid_at, card_failed_at")
    .eq("id", rideId)
    .maybeSingle();
  if (!r || r.customer_id !== cust.id) return null;
  return {
    paid: r.online_paid_at != null,
    failed: r.online_paid_at == null && r.card_failed_at != null,
    cancelled: r.status === "cancelled",
  };
}

/* ─────────────────────────── Favoris ─────────────────────────── */

export async function toggleFavoriteChauffeur(
  chauffeurId: string,
  on: boolean
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };
  const { data: cust } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!cust) return { ok: false, error: "no_customer" };
  if (on) {
    // RLS (mig 0149) : insert refusé tant qu'aucune course TERMINÉE avec ce
    // chauffeur — le bouton n'apparaît d'ailleurs qu'en fin de course.
    const { error } = await supabase
      .from("customer_favorite_chauffeurs")
      .upsert({ customer_id: cust.id, chauffeur_id: chauffeurId });
    if (error)
      return {
        ok: false,
        error: error.code === "42501" ? "no_completed_ride" : error.message,
      };
  } else {
    const { error } = await supabase
      .from("customer_favorite_chauffeurs")
      .delete()
      .eq("customer_id", cust.id)
      .eq("chauffeur_id", chauffeurId);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

/* ─────────────────────────── Historique + favoris ─────────────────────────── */

export type DriveHistory = {
  rides: {
    id: string;
    dest_text: string | null;
    when: string;
    chauffeur_name: string | null;
    price_da: number;
    completed: boolean;
  }[];
  favorites: {
    chauffeur_id: string;
    name: string;
    avatar_url: string | null;
    rating: number | null;
    rides_count: number;
    vehicle: string | null;
  }[];
};

export async function getDriveHistory(): Promise<DriveHistory> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { rides: [], favorites: [] };
  const { data: cust } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!cust) return { rides: [], favorites: [] };

  const [{ data: rides }, { data: favs }] = await Promise.all([
    admin
      .from("rides")
      .select(
        "id, dest_text, created_at, status, agreed_price_da, proposed_price_da, chauffeurs(first_name, full_name)"
      )
      .eq("customer_id", cust.id)
      // Annulée AVANT attribution (recherche abandonnée, carte échouée, TTL)
      // = pas une vraie course → masquée pour ne pas encombrer l'historique.
      .or(
        "status.eq.completed,and(status.eq.cancelled,chauffeur_id.not.is.null)"
      )
      .order("created_at", { ascending: false })
      .limit(30),
    admin
      .from("customer_favorite_chauffeurs")
      .select(
        "chauffeur_id, chauffeurs(id, first_name, full_name, vehicle_make, vehicle_model, vehicle_color)"
      )
      .eq("customer_id", cust.id)
      .order("created_at", { ascending: false }),
  ]);

  const favAvatars = await chauffeurAvatarUrls(
    (favs ?? []).map((f) => f.chauffeur_id)
  );
  const favorites = await Promise.all(
    (favs ?? []).map(async (f) => {
      const ch = f.chauffeurs as unknown as {
        id: string;
        first_name: string | null;
        full_name: string;
        vehicle_make: string | null;
        vehicle_model: string | null;
        vehicle_color: string | null;
      } | null;
      const [{ data: avg }, { count }] = await Promise.all([
        admin
          .from("rides")
          .select("chauffeur_rating.avg()")
          .eq("chauffeur_id", f.chauffeur_id)
          .not("chauffeur_rating", "is", null)
          .maybeSingle(),
        admin
          .from("rides")
          .select("id", { count: "exact", head: true })
          .eq("chauffeur_id", f.chauffeur_id)
          .eq("status", "completed"),
      ]);
      const rating = (avg as { avg?: number } | null)?.avg;
      return {
        chauffeur_id: f.chauffeur_id,
        name: ch ? (ch.first_name ?? ch.full_name.split(" ")[0]) : "Chauffeur",
        avatar_url: favAvatars.get(f.chauffeur_id) ?? null,
        rating: rating == null ? null : Math.round(Number(rating) * 10) / 10,
        rides_count: count ?? 0,
        vehicle: ch
          ? [
              [ch.vehicle_make, ch.vehicle_model].filter(Boolean).join(" "),
              ch.vehicle_color,
            ]
              .filter(Boolean)
              .join(" · ") || null
          : null,
      };
    })
  );

  return {
    rides: (rides ?? []).map((r) => {
      const ch = r.chauffeurs as unknown as {
        first_name: string | null;
        full_name: string;
      } | null;
      return {
        id: r.id,
        dest_text: r.dest_text,
        when: r.created_at,
        chauffeur_name: ch
          ? (ch.first_name ?? ch.full_name.split(" ")[0])
          : null,
        price_da: r.agreed_price_da ?? r.proposed_price_da ?? 0,
        completed: r.status === "completed",
      };
    }),
    favorites,
  };
}

/* ─────────────────────────── Messages rapides ─────────────────────────── */

export type RideMessage = {
  id: string;
  sender: "customer" | "chauffeur";
  body: string;
  created_at: string;
};

export async function getRideMessages(rideId: string): Promise<RideMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ride_messages")
    .select("id, sender, body, created_at")
    .eq("ride_id", rideId)
    .order("created_at", { ascending: true })
    .limit(80);
  return (data ?? []) as RideMessage[];
}

export async function sendRideMessage(
  rideId: string,
  body: string
): Promise<{ ok: boolean; error?: string }> {
  const text = body.trim().slice(0, 500);
  if (!text) return { ok: false, error: "empty" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };
  const { error } = await supabase
    .from("ride_messages")
    .insert({ ride_id: rideId, sender: "customer", body: text });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ─────────────────── Contacts d'urgence (sécurité) ─────────────────── */

export type SosContact = { name: string; phone: string };

export async function getSosContacts(): Promise<SosContact[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("customers")
    .select("sos_contacts")
    .eq("user_id", user.id)
    .maybeSingle();
  const raw = (data?.sos_contacts ?? []) as SosContact[];
  return Array.isArray(raw)
    ? raw.filter((c) => c && c.name && c.phone).slice(0, 3)
    : [];
}

export async function setSosContacts(
  contacts: SosContact[]
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };
  const clean = (contacts ?? [])
    .map((c) => ({
      name: String(c.name ?? "")
        .trim()
        .slice(0, 40),
      phone: String(c.phone ?? "")
        .trim()
        .slice(0, 20),
    }))
    .filter((c) => c.name && c.phone.length >= 9)
    .slice(0, 3);
  const { error } = await supabase
    .from("customers")
    .update({ sos_contacts: clean })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
