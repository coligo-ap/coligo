"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chauffeurAvatarUrls } from "@/lib/drive/avatar-server";
import {
  notifyChauffeursNewRide,
  notifyChauffeursRideGone,
  notifyRideMessage,
} from "@/lib/fcm/triggers";
import { notifyRideEvent } from "@/lib/notifications/notify";
import { fraudIngestCancel } from "@/lib/fraud/events";
import { getCustomerFraudGate } from "@/lib/fraud/gate";
import {
  evaluateZone,
  logZoneBlock,
  resolveWilayaCommune,
} from "@/lib/zones/server";
import { zoneMessageFr } from "@/lib/zones/service-zones";
import {
  issuePriceQuote,
  verifyPriceQuote,
  quoteRejectionMessage,
} from "@/lib/data/geo-quote";
import { roadRoute } from "@/lib/drive/routing";

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
  /** Réservation programmée (masquée si false) + horizon/lead. */
  scheduledEnabled: boolean;
  scheduledMaxDays: number;
  scheduledLeadMin: number;
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
        "drive_price_step_da, drive_boost_min_da, drive_boost_step_da, drive_boost_default_rate, drive_female_filter_enabled, drive_deviation_km, drive_deviation_min, drive_scheduled_enabled, drive_scheduled_max_days, drive_scheduled_lead_min"
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
    scheduledEnabled: settings?.drive_scheduled_enabled ?? false,
    scheduledMaxDays: settings?.drive_scheduled_max_days ?? 7,
    scheduledLeadMin: settings?.drive_scheduled_lead_min ?? 15,
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
  pickup?: { lat: number; lng: number } | null,
  /** Durée RÉELLE de navigation (OSRM, min) → supplément trafic (mig 0235). */
  durationMin?: number | null
): Promise<Record<"classic" | "confort" | "moto", DriveQuote>> {
  const rpc = await rpcClient();
  const gammes = ["classic", "confort", "moto"] as const;
  const out = {} as Record<(typeof gammes)[number], DriveQuote>;

  // UN SEUL aller-retour (mig 0366) : les 3 gammes + fourchettes d'un coup —
  // le client attend CE prix à l'écran, chaque requête économisée se voit.
  const { data, error } = await rpc("drive_quotes_all", {
    p_distance_km: distanceKm,
    p_pickup_lat: pickup?.lat ?? null,
    p_pickup_lng: pickup?.lng ?? null,
    p_duration_min: durationMin ?? null,
  });
  if (!error && Array.isArray(data)) {
    for (const g of gammes) {
      const row = (
        data as {
          gamme: string;
          floor_da: number;
          mini_da: number;
          reco_da: number;
          fast_da: number;
          low_da: number | null;
          high_da: number | null;
        }[]
      ).find((r) => r.gamme === g);
      out[g] = {
        recommended: row?.reco_da ?? 0,
        floor: row?.floor_da ?? 0,
        mini: row?.mini_da ?? 0,
        fast: row?.fast_da ?? 0,
        low: row?.low_da ?? 0,
        high: row?.high_da ?? 0,
      };
    }
    return out;
  }

  // Repli (déploiement en cours : app à jour AVANT la migration) : ancien
  // chemin en 6 RPC, même résultat.
  await Promise.all(
    gammes.map(async (g) => {
      const [smart, range] = await Promise.all([
        rpc("drive_smart_quote", {
          p_distance_km: distanceKm,
          p_gamme: g,
          p_pickup_lat: pickup?.lat ?? null,
          p_pickup_lng: pickup?.lng ?? null,
          p_duration_min: durationMin ?? null,
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

/**
 * Émet un DEVIS SIGNÉ pour le prix Drive affiché (Partie D). Le client appelle
 * ceci dès qu'il a un prix estimé (départ + arrivée connus) et garde le
 * `quoteId` retourné ; il le repasse à `requestRide`. Le serveur le vérifie et
 * le consomme → impossible de réserver sur un prix périmé/incohérent. Distance
 * recalculée serveur dans la RPC. Best-effort : null si échec (non bloquant).
 */
export async function issueDriveQuote(input: {
  pickup_lat: number;
  pickup_lng: number;
  pickup_text?: string | null;
  dest_lat: number;
  dest_lng: number;
  dest_text?: string | null;
  price_da: number;
  gamme: "classic" | "confort" | "moto";
}): Promise<{ quoteId: string; expiresAt: string } | null> {
  const q = await issuePriceQuote({
    context: "drive",
    pickup: {
      lat: input.pickup_lat,
      lng: input.pickup_lng,
      text: input.pickup_text ?? null,
    },
    dest: {
      lat: input.dest_lat,
      lng: input.dest_lng,
      text: input.dest_text ?? null,
    },
    priceDa: input.price_da,
    meta: { gamme: input.gamme },
  });
  return q ? { quoteId: q.quoteId, expiresAt: q.expiresAt } : null;
}

/**
 * Offre « Bienvenue » 1ʳᵉ course (ancrage cosmétique, coût plateforme 0) :
 * pour un nouveau client, renvoie un prix gonflé barré (anchor) que le code
 * BIENVENUE ramène au prix réel (pay = reco). Le chauffeur touche le réel.
 */
export async function getFirstRideOffer(recoDa: number): Promise<{
  isNew: boolean;
  anchor: number;
  pay: number;
  save: number;
  code: string | null;
}> {
  const rpc = await rpcClient();
  const { data } = await rpc("drive_first_ride_offer", {
    p_reco_da: Math.max(0, Math.floor(recoDa)),
  });
  const r = (Array.isArray(data) ? data[0] : null) as {
    is_new: boolean;
    anchor_da: number;
    pay_da: number;
    save_da: number;
    code: string | null;
  } | null;
  return {
    isNew: Boolean(r?.is_new),
    anchor: r?.anchor_da ?? recoDa,
    pay: r?.pay_da ?? recoDa,
    save: r?.save_da ?? 0,
    code: r?.code ?? null,
  };
}

/**
 * Réserver une course PROGRAMMÉE (espèces, prix figé au devis stable). Gated
 * super-admin (échoue si la feature est désactivée).
 */
export async function requestScheduledRide(input: {
  pickup_lat: number;
  pickup_lng: number;
  pickup_text?: string | null;
  dest_lat: number;
  dest_lng: number;
  dest_text?: string | null;
  distance_km: number;
  gamme: "classic" | "confort" | "moto";
  scheduled_at: string;
  proxy_name?: string | null;
  proxy_phone?: string | null;
  operation_id?: string | null;
}): Promise<{ ok: boolean; rideId?: string; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("request_scheduled_ride", {
    p_pickup_lat: input.pickup_lat,
    p_pickup_lng: input.pickup_lng,
    p_pickup_text: input.pickup_text ?? null,
    p_dest_lat: input.dest_lat,
    p_dest_lng: input.dest_lng,
    p_dest_text: input.dest_text ?? null,
    p_distance_km: input.distance_km,
    p_gamme: input.gamme,
    p_scheduled_at: input.scheduled_at,
    p_proxy_name: input.proxy_name ?? null,
    p_proxy_phone: input.proxy_phone ?? null,
    p_operation_id: input.operation_id ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const rideId = typeof data === "string" ? data : undefined;
  return { ok: true, rideId };
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
  /** Devis signé émis par issueDriveQuote — anti-prix-périmé (Partie D). */
  quote_id?: string | null;
}): Promise<{ ok: boolean; rideId?: string; error?: string }> {
  const rpc = await rpcClient();

  // Anti-fraude (mig 0374) : compte suspendu OU avertissement obligatoire non
  // lu → pas de nouvelle course (défense en profondeur — la popup bloquante
  // est montée par le layout client).
  const fraudGate = await getCustomerFraudGate();
  if (fraudGate.suspended) {
    return {
      ok: false,
      error: "Ton compte est suspendu. Contacte le support Coligo.",
    };
  }
  if (fraudGate.requireAck) {
    return {
      ok: false,
      error:
        "Un avertissement important t'attend — lis-le et confirme pour continuer.",
    };
  }

  // Anti-prix-périmé (Partie D) : si un devis a été émis, on le VÉRIFIE et le
  // CONSOMME pour le trajet courant AVANT d'engager le prix. Adresse changée /
  // devis expiré / déjà utilisé → refus net (le client re-demande un prix).
  if (input.quote_id) {
    const chk = await verifyPriceQuote({
      quoteId: input.quote_id,
      context: "drive",
      pickup: { lat: input.pickup_lat, lng: input.pickup_lng },
      dest: { lat: input.dest_lat, lng: input.dest_lng },
      consume: true,
    });
    if (!chk.ok) {
      return { ok: false, error: quoteRejectionMessage(chk.reason) };
    }
  }

  // Reverse-géocode départ + arrivée (zones, mig 0174) + distance routière
  // AUTORITAIRE recalculée serveur (A) : on ne fait JAMAIS confiance au km du
  // client pour le plancher de prix (un km falsifié = plancher trop bas). OSRM
  // réel, sinon ligne droite × détour appris (mig 0235).
  const [pickupGeo, destGeo, road] = await Promise.all([
    resolveWilayaCommune(input.pickup_lat, input.pickup_lng),
    resolveWilayaCommune(input.dest_lat, input.dest_lng),
    roadRoute(
      { lat: input.pickup_lat, lng: input.pickup_lng },
      { lat: input.dest_lat, lng: input.dest_lng }
    ),
  ]);
  // Le serveur impose sa distance (≥ celle du client pour ne jamais sous-coter).
  const authoritativeKm = Math.max(
    road.km,
    Math.max(0, input.distance_km || 0)
  );
  const { data, error } = await rpc("request_ride", {
    p_pickup_lat: input.pickup_lat,
    p_pickup_lng: input.pickup_lng,
    p_pickup_text: input.pickup_text ?? null,
    p_dest_lat: input.dest_lat,
    p_dest_lng: input.dest_lng,
    p_dest_text: input.dest_text ?? null,
    p_distance_km: authoritativeKm,
    p_proposed_price: Math.max(0, Math.floor(input.proposed_price_da)),
    p_payment_method: input.payment_method,
    p_gamme: input.gamme,
    p_boost_da: Math.max(0, Math.floor(input.boost_da)),
    p_female_only: input.female_only,
    p_proxy_name: input.proxy_name ?? null,
    p_proxy_phone: input.proxy_phone ?? null,
    p_operation_id: input.operation_id ?? null,
    p_pickup_wilaya: pickupGeo.wilayaCode,
    p_pickup_commune: pickupGeo.commune,
    p_dest_wilaya: destGeo.wilayaCode,
    p_dest_commune: destGeo.commune,
  });
  if (error) {
    // Refus de zone réel → journalisation ops (best-effort, mig 0170).
    if (error.message.includes("drive_zone")) {
      const isMax = error.message.includes("drive_zone_maxdist");
      const isOrigin = error.message.includes("drive_zone_origin");
      const reason = isMax
        ? "maxdist"
        : error.message.includes("service_inactive")
          ? "service_inactive"
          : error.message.includes("no_coverage")
            ? "no_coverage"
            : "blocked";
      void logZoneBlock({
        service: "drive",
        source: "drive",
        role: isOrigin ? "origin" : "destination",
        reason,
        lat: isOrigin ? input.pickup_lat : input.dest_lat,
        lng: isOrigin ? input.pickup_lng : input.dest_lng,
        wilayaCode: isOrigin ? pickupGeo.wilayaCode : destGeo.wilayaCode,
        commune: isOrigin ? pickupGeo.commune : destGeo.commune,
      });
    }
    return { ok: false, error: driveZoneError(error.message) };
  }
  const rideId = typeof data === "string" ? data : undefined;
  if (rideId) {
    void notifyChauffeursNewRide({ rideId });
    void triggerDemoResponder(rideId);
  }
  return { ok: true, rideId };
}

/**
 * Re-dispatch ESCALADÉ (mig 0255) — déclenché par le poll du CLIENT en attente
 * quand sa course « searching » tarde à recevoir des offres. Élargit d'un cran
 * le rayon de DIFFUSION (serveur autoritaire : ownership + intervalle mini +
 * plafond 25 km) puis re-diffuse aux chauffeurs nouvellement à portée — la garde
 * par zone de travail de chaque chauffeur reste appliquée. No-op (silencieux) si
 * ce n'est pas le moment, si on est au plafond, ou si la course n'est plus
 * éligible. Best-effort : ne jette jamais, ne bloque pas le poll client.
 */
export async function escalateDispatch(rideId: string): Promise<void> {
  try {
    const rpc = await rpcClient();
    const { data, error } = await rpc("drive_escalate_dispatch", {
      p_ride_id: rideId,
    });
    if (error) return;
    // Rayon élargi → re-diffuser (notifyChauffeursNewRide lit dispatch_radius_km).
    if (typeof data === "number" && data > 0) {
      void notifyChauffeursNewRide({ rideId });
    }
  } catch {
    /* best-effort — l'escalade ne doit jamais casser l'attente client */
  }
}

/**
 * Traduit les erreurs ZONE du RPC request_ride (mig 0169) en message client
 * clair. Les codes : drive_zone_origin:<reason> / drive_zone_dest:<reason> /
 * drive_zone_maxdist:<km>. Sinon on renvoie le message brut.
 */
function driveZoneError(msg: string): string {
  if (msg.includes("drive_zone_maxdist")) {
    const km = msg.split(":")[1]?.trim();
    return km
      ? `Trajet trop long (max ${km} km pour Coligo Drive).`
      : "Ce trajet dépasse la distance maximale autorisée.";
  }
  if (msg.includes("drive_zone_origin")) {
    return zoneMessageFr(
      {
        allowed: false,
        reason: msg.includes("service_inactive")
          ? "service_inactive"
          : "blocked",
        label: null,
        coming_soon: false,
      },
      "origin",
      "drive"
    );
  }
  if (msg.includes("drive_zone_dest")) {
    return zoneMessageFr(
      {
        allowed: false,
        reason: msg.includes("service_inactive")
          ? "service_inactive"
          : "blocked",
        label: null,
        coming_soon: false,
      },
      "destination",
      "drive"
    );
  }
  return msg;
}

/**
 * Pré-check de couverture d'un trajet Drive (départ + arrivée) — pour l'UX
 * AVANT la demande (bouton désactivé + message inline). L'enforcement réel
 * reste dans request_ride (bypass-proof). Renvoie le 1ᵉʳ point bloquant.
 */
export async function precheckDriveRoute(input: {
  pickup_lat: number;
  pickup_lng: number;
  dest_lat: number;
  dest_lng: number;
}): Promise<{ ok: boolean; error?: string }> {
  // Reverse-géocode départ + arrivée → wilaya/commune, sinon une commune
  // bloquée (scope 'commune') ne serait jamais détectée ici (mig 0174).
  const [pickupGeo, destGeo] = await Promise.all([
    resolveWilayaCommune(input.pickup_lat, input.pickup_lng),
    resolveWilayaCommune(input.dest_lat, input.dest_lng),
  ]);
  const org = await evaluateZone("drive", input.pickup_lat, input.pickup_lng, {
    role: "origin",
    wilayaCode: pickupGeo.wilayaCode,
    commune: pickupGeo.commune,
  });
  if (!org.allowed)
    return { ok: false, error: zoneMessageFr(org, "origin", "drive") };
  const dst = await evaluateZone("drive", input.dest_lat, input.dest_lng, {
    role: "destination",
    wilayaCode: destGeo.wilayaCode,
    commune: destGeo.commune,
  });
  if (!dst.allowed)
    return { ok: false, error: zoneMessageFr(dst, "destination", "drive") };
  return { ok: true };
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
  /** Abonné Prioritaire (ch.7) — badge montré au client. */
  is_priority: boolean;
  /** Badge du plan du chauffeur (0304) — anneau coloré autour de sa photo. */
  badge_label: string | null;
  badge_color: string | null;
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
      is_priority: Boolean(o.is_priority),
      badge_label: (o.badge_label as string) ?? null,
      badge_color: (o.badge_color as string) ?? null,
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
  if (row?.ok && row.ride_id) {
    // Cloche + push chauffeur : le client vient de confirmer SA proposition.
    void notifyRideEvent(row.ride_id, "ride_accepted");
    // Et la demande DISPARAÎT immédiatement chez tous les autres chauffeurs
    // (retrait temps réel `ride_gone`, sans attendre leur poll) ; le retenu,
    // lui, bascule sur sa course à réception du même message.
    void notifyChauffeursRideGone({ rideId: row.ride_id });
    return { ok: true, rideId: row.ride_id };
  }
  return { ok: false, error: row?.reason };
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
  // Notifie le chauffeur attribué s'il y en a un (no-op avant attribution).
  if (row?.ok) {
    void notifyRideEvent(rideId, "ride_cancelled_by_customer");
    // Recherche annulée → la demande DISPARAÎT immédiatement des écrans des
    // chauffeurs qui la voyaient (retrait temps réel, sans attendre leur poll).
    void notifyChauffeursRideGone({ rideId });
    // Anti-fraude : contexte de l'annulation (phase, position chauffeur, contact)
    void fraudIngestCancel("ride", rideId, "customer");
  }
  return row?.ok ? { ok: true } : { ok: false, error: row?.reason };
}

/* ─────────────────────────── Course active ─────────────────────────── */

/**
 * Badge (couleur/label) du plan actif de chaque chauffeur (0304) → anneau coloré
 * autour de l'avatar dans le suivi. Vide si plan par défaut (pas de badge). Lecture
 * service_role (drive_plans/subscriptions non lisibles par le client via RLS) ;
 * seules la couleur et le libellé — non sensibles — sont exposés.
 */
async function chauffeurPlanBadges(
  ids: string[]
): Promise<Map<string, { label: string | null; color: string | null }>> {
  const out = new Map<string, { label: string | null; color: string | null }>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return out;
  const admin =
    createAdminClient() as unknown as import("@supabase/supabase-js").SupabaseClient;
  const { data: subs } = await admin
    .from("chauffeur_subscriptions")
    .select("chauffeur_id, plan, period_end")
    .in("chauffeur_id", uniq)
    .eq("status", "active")
    .gte("period_end", new Date().toISOString())
    .order("period_end", { ascending: false });
  const planOf = new Map<string, string>();
  for (const s of (subs ?? []) as { chauffeur_id: string; plan: string }[])
    if (!planOf.has(s.chauffeur_id)) planOf.set(s.chauffeur_id, s.plan);
  const codes = [...new Set(planOf.values())];
  if (codes.length > 0) {
    const { data: plans } = await admin
      .from("drive_plans")
      .select("code, badge_label, badge_color")
      .in("code", codes);
    const byCode = new Map(
      (
        (plans ?? []) as {
          code: string;
          badge_label: string | null;
          badge_color: string | null;
        }[]
      ).map((p) => [p.code, { label: p.badge_label, color: p.badge_color }])
    );
    for (const [ch, code] of planOf) {
      const b = byCode.get(code);
      if (b && b.color) out.set(ch, b);
    }
  }
  // Pass Prioritaire (produit séparé, mig 0210) : anneau violet si le chauffeur
  // n'a pas déjà un badge de plan de commission.
  const { data: pri } = await admin
    .from("priority_subscriptions")
    .select("subject_id")
    .eq("subject_type", "chauffeur")
    .in("subject_id", uniq)
    .eq("status", "active")
    .gte("period_end", new Date().toISOString());
  for (const row of (pri ?? []) as { subject_id: string }[])
    if (!out.has(row.subject_id))
      out.set(row.subject_id, { label: "Prioritaire", color: "#6C2BD9" });
  return out;
}

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
    /** Anneau coloré du plan (0304) autour de la photo pendant le suivi. */
    badge_color: string | null;
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
          badge_color:
            (await chauffeurPlanBadges([r.chauffeur_id as string])).get(
              r.chauffeur_id as string
            )?.color ?? null,
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
  /** Pourboire déjà laissé (0 = aucun) — mig 0363. */
  tip_da: number;
  /** Solde Coligo Pay courant (module pourboire masqué si insuffisant). */
  wallet_balance_da: number;
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
      "id, status, pickup_text, dest_text, agreed_price_da, proposed_price_da, boost_amount_da, payment_method, cash_due_da, commission_rate_applied, cashback_da, chauffeur_rating, chauffeur_id, tip_da, completed_at, cancelled_at, chauffeurs(first_name, full_name)"
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
  // Solde Coligo Pay : conditionne l'affichage du module pourboire.
  const { data: bal } = await supabase.rpc("customer_topup_balance", {
    p_customer_id: cust.id,
  });
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
    tip_da: (r as unknown as { tip_da?: number }).tip_da ?? 0,
    wallet_balance_da: typeof bal === "number" ? bal : 0,
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

/**
 * Pourboire Coligo Pay (mig 0363) : serveur autoritaire (solde, bornes 20-2000,
 * une seule fois, 24 h) — le montant est débité du wallet client et crédité au
 * chauffeur (`ride_ledger.chauffeur_tip`), avec cloche + push au chauffeur.
 */
export async function tipDriveRide(
  rideId: string,
  amountDa: number
): Promise<{ ok: boolean; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("drive_tip_ride", {
    p_ride_id: rideId,
    p_amount_da: Math.round(amountDa),
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  if (row?.ok) {
    void notifyRideEvent(rideId, "ride_tip", {
      amountDa: Math.round(amountDa),
    });
    return { ok: true };
  }
  return { ok: false, error: row?.reason };
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

/* ─────────────── Paiement carte INTERNATIONALE € (Stripe) ─────────────── */

/**
 * L'option « Carte internationale (€) » est-elle proposable à CE client ?
 * (flag + clés + pays IP + capacité — mode 'visibility', zéro fetch réseau).
 * Appelée au montage de l'écran prix ; la création de paiement re-vérifie
 * TOUT en mode autoritaire de toute façon.
 */
export async function rideIntlAvailability(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { data: cust } = await supabase
      .from("customers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!cust) return false;
    const { checkIntlEligibility } = await import("@/lib/payments/intl");
    const elig = await checkIntlEligibility({
      customerId: cust.id,
      mode: "visibility",
    });
    return elig.ok;
  } catch {
    return false;
  }
}

/**
 * Course payée en CARTE INTERNATIONALE (€) : PaymentIntent Stripe sur le
 * prix DA converti au taux maison (jamais exposé) → feuille de paiement
 * EMBARQUÉE. Le webhook payment_intent.succeeded pose le séquestre
 * (drive_card_paid) et déclenche la diffusion — même contrat que Chargily.
 */
export async function createRideIntlPayment(rideId: string): Promise<
  | {
      ok: true;
      client_secret: string;
      publishable_key: string;
      eur_cents: number;
    }
  | { ok: false; error: string }
> {
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
  const amount =
    ride.agreed_price_da ??
    (ride.proposed_price_da ?? 0) + (ride.boost_amount_da ?? 0);
  if (!amount || amount <= 0) return { ok: false, error: "no_amount" };

  try {
    const [{ checkIntlEligibility, getRequestCountry }, stripeMod] =
      await Promise.all([
        import("@/lib/payments/intl"),
        import("@/lib/payments/stripe"),
      ]);
    const elig = await checkIntlEligibility({
      customerId: cust.id,
      totalDa: amount,
      mode: "authoritative",
    });
    if (!elig.ok) return { ok: false, error: `intl_${elig.reason}` };
    const publishableKey = await stripeMod.getPublishableKey();
    if (!publishableKey) return { ok: false, error: "intl_off" };
    const intent = await stripeMod.createIntlPaymentIntent({
      orderId: ride.id,
      eurCents: elig.eur_cents!,
      description: "Course Coligo Drive",
      metadata: { type: "ride", ride_id: ride.id },
    });
    const { error: sessErr } = await (
      admin.from("intl_payment_sessions" as never) as unknown as {
        insert: (row: Record<string, unknown>) => Promise<{
          error: { message: string } | null;
        }>;
      }
    ).insert({
      ride_id: ride.id,
      customer_id: cust.id,
      stripe_payment_intent: intent.id,
      eur_cents: elig.eur_cents!,
      total_da: amount,
      rate_da: elig.rate.rate_da,
      rate_source: elig.rate.source,
      ip_country: await getRequestCountry(),
    });
    if (sessErr) {
      console.error("[drive] intl session insert:", sessErr.message);
      return { ok: false, error: "intl_session" };
    }
    return {
      ok: true,
      client_secret: intent.clientSecret,
      publishable_key: publishableKey,
      eur_cents: elig.eur_cents!,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "stripe_error",
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
  delivered_at: string | null;
  read_at: string | null;
};

export async function getRideMessages(rideId: string): Promise<RideMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ride_messages")
    .select("id, sender, body, created_at, delivered_at, read_at")
    .eq("ride_id", rideId)
    .order("created_at", { ascending: true })
    .limit(80);
  return (data ?? []) as RideMessage[];
}

/**
 * Marque les messages du CHAUFFEUR comme reçus (read=false) ou lus (read=true)
 * → le chauffeur voit « Reçu » / « Lu » sur ses messages (mig 0175).
 */
export async function markRideMessagesRead(
  rideId: string,
  read = true
): Promise<void> {
  try {
    const rpc = await rpcClient();
    await rpc("mark_ride_messages_read", { p_ride_id: rideId, p_read: read });
  } catch {
    /* best-effort */
  }
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
  // Push au chauffeur (fire-and-forget).
  void notifyRideMessage({ rideId, senderRole: "customer", body: text });
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

/**
 * Le client AFFICHE / MASQUE son vrai numéro au chauffeur (sinon Coligo Call
 * uniquement). Gating SERVEUR via RPC set_ride_phone_shared (propriété de la
 * course + statut actif vérifiés en base). Retour : true si appliqué.
 */
export async function setRidePhoneShared(
  rideId: string,
  shared: boolean
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: boolean | null; error: { message: string } | null }>
  )("set_ride_phone_shared", { p_ride_id: rideId, p_shared: shared });
  if (error) return { ok: false };
  return { ok: data === true };
}

/** Lit l'état de partage du numéro pour une course (le client possède la course). */
export async function getRidePhoneShared(rideId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rides")
    .select("client_phone_shared")
    .eq("id", rideId)
    .maybeSingle();
  return Boolean(
    (data as { client_phone_shared?: boolean } | null)?.client_phone_shared
  );
}
