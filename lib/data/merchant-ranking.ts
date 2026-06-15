// =============================================================================
// Algorithme de classement des commerçants — score composite déterministe.
// =============================================================================
// 5 signaux (poids ajustables) :
//   - rating   (note moyenne) ........ poids 30 %
//   - popular  (commandes 30j) ....... poids 25 %
//   - promo    (promo active) ........ poids 15 %
//   - distance (proximité GPS) ....... poids 20 %  (si lat/lng client connu)
//   - open     (ouvert maintenant) ... poids 10 %  (Africa/Algiers)
//
// Le score final est dans [0, 1]. Formule explicite, signaux authentiques
// (non manipulables côté client : tous viennent de la DB sauf la position
// du client qu'on utilise uniquement pour la distance).
//
// Les poids sont configurables via platform_settings.ranking_weights (JSONB)
// si présent. Si absent, on tombe sur DEFAULT_WEIGHTS.
//
// ⚠️ Si le client n'a PAS de coords (latitude/longitude null), la composante
// distance est neutralisée (poids redistribué proportionnellement aux autres).
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { isOpenNow, nowInAlgiers } from "@/lib/merchant/opening-hours";
import type { PublicMerchant } from "@/lib/data/merchants-public";

export type RankingWeights = {
  rating: number;
  popular: number;
  promo: number;
  distance: number;
  open: number;
};

export const DEFAULT_WEIGHTS: RankingWeights = {
  rating: 0.3,
  popular: 0.25,
  promo: 0.15,
  distance: 0.2,
  open: 0.1,
};

export type RankingContext = {
  promoIds: Set<string>;
  orderCounts30d: Map<string, number>;
  customer: { latitude: number | null; longitude: number | null } | null;
  weights: RankingWeights;
};

/**
 * Charge les signaux dépendant de la DB pour un set de merchant_ids :
 *   - les IDs avec promo active
 *   - le nombre de commandes completed dans les 30 derniers jours
 *   - les poids configurés sur platform_settings (ou DEFAULT_WEIGHTS)
 */
export async function loadRankingContext(opts: {
  merchantIds: string[];
  customer: { latitude: number | null; longitude: number | null } | null;
}): Promise<RankingContext> {
  const supabase = await createClient();

  // Note : ces 3 requêtes peuvent partir en parallèle.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const [promos, orderRows, settings] = await Promise.all([
    supabase
      .from("promotions")
      .select("merchant_id")
      .eq("status", "active")
      .in("merchant_id", opts.merchantIds),
    supabase
      .from("orders")
      .select("merchant_id")
      .eq("status", "completed")
      .gte("created_at", since)
      .in("merchant_id", opts.merchantIds),
    supabase
      .from("platform_settings")
      .select("ranking_weights")
      .eq("id", true)
      .maybeSingle(),
  ]);

  const promoIds = new Set(
    (promos.data ?? []).map((r) => r.merchant_id as string)
  );

  const orderCounts30d = new Map<string, number>();
  for (const row of orderRows.data ?? []) {
    const id = row.merchant_id as string;
    orderCounts30d.set(id, (orderCounts30d.get(id) ?? 0) + 1);
  }

  const weights = parseWeights(
    (settings.data as { ranking_weights?: unknown } | null)?.ranking_weights
  );

  return {
    promoIds,
    orderCounts30d,
    customer: opts.customer,
    weights,
  };
}

/**
 * Calcule le score d'un commerçant donné dans le contexte fourni.
 * Renvoie un nombre dans [0, 1]. Le tri par score DÉCROISSANT donne le
 * classement de la home.
 */
export function computeMerchantScore(
  merchant: PublicMerchant,
  ctx: RankingContext
): number {
  const w = ctx.weights;

  // Signal 1 : note moyenne (rating_avg ∈ [1,5] → [0,1])
  // Si rating_count === 0, on neutralise (signal = 0).
  const rating =
    merchant.rating_count > 0
      ? Math.max(0, Math.min(1, (merchant.rating_avg - 1) / 4))
      : 0;

  // Signal 2 : popularité (commandes 30j) — log normalisé pour ne pas
  // donner un poids disproportionné aux gros volumes.
  const orders30 = ctx.orderCounts30d.get(merchant.id) ?? 0;
  const popular = Math.min(1, Math.log(1 + orders30) / Math.log(1 + 100));

  // Signal 3 : promo active (boolean)
  const promo = ctx.promoIds.has(merchant.id) ? 1 : 0;

  // Signal 4 : proximité GPS (linéaire jusqu'à 10 km).
  // Si pas de lat/lng client OU commerçant → signal neutralisé (poids
  // redistribué).
  let distance: number | null = null;
  if (
    ctx.customer?.latitude != null &&
    ctx.customer?.longitude != null &&
    merchant.latitude != null &&
    merchant.longitude != null
  ) {
    const km = haversineKm(
      ctx.customer.latitude,
      ctx.customer.longitude,
      merchant.latitude,
      merchant.longitude
    );
    distance = Math.max(0, 1 - Math.min(km / 10, 1));
  }

  // Signal 5 : ouvert maintenant (Africa/Algiers)
  const open = isOpenNow(merchant.opening_hours, nowInAlgiers()) ? 1 : 0;

  // Composition avec redistribution si distance neutralisée.
  if (distance === null) {
    const total = w.rating + w.popular + w.promo + w.open;
    if (total === 0) return 0;
    return (
      (rating * w.rating +
        popular * w.popular +
        promo * w.promo +
        open * w.open) /
      total
    );
  }
  const total = w.rating + w.popular + w.promo + w.distance + w.open;
  if (total === 0) return 0;
  return (
    (rating * w.rating +
      popular * w.popular +
      promo * w.promo +
      distance * w.distance +
      open * w.open) /
    total
  );
}

/**
 * Trie les commerçants par score décroissant, avec OUVERTS D'ABORD.
 * (Le statut ouvert/fermé est déjà un facteur dans le score, mais on
 * applique en plus un découpage strict pour respecter l'UX prompt 20.)
 */
export function rankMerchants(
  merchants: PublicMerchant[],
  ctx: RankingContext
): PublicMerchant[] {
  // Score pré-calculé par commerçant pour éviter le recompute pendant le sort.
  const scored = merchants.map((m) => ({
    m,
    open: isOpenNow(m.opening_hours, nowInAlgiers()),
    score: computeMerchantScore(m, ctx),
  }));
  scored.sort((a, b) => {
    // Ouverts d'abord.
    if (a.open !== b.open) return a.open ? -1 : 1;
    // Puis score décroissant.
    return b.score - a.score;
  });
  return scored.map((s) => s.m);
}

/**
 * Découpe OUVERTS d'abord en PRÉSERVANT l'ordre d'entrée dans chaque groupe.
 * Utilisé quand la liste est déjà classée par proximité (chemin nearby) : on
 * veut juste remonter les ouverts sans casser le tri par distance.
 */
export function splitOpenFirst(merchants: PublicMerchant[]): PublicMerchant[] {
  const now = nowInAlgiers();
  return merchants
    .map((m, i) => ({ m, i, open: isOpenNow(m.opening_hours, now) }))
    .sort((a, b) => (a.open !== b.open ? (a.open ? -1 : 1) : a.i - b.i))
    .map((s) => s.m);
}

// -----------------------------------------------------------------------------
// Utilitaires
// -----------------------------------------------------------------------------

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // rayon Terre km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function parseWeights(raw: unknown): RankingWeights {
  if (!raw || typeof raw !== "object") return DEFAULT_WEIGHTS;
  const r = raw as Record<string, unknown>;
  const get = (k: keyof RankingWeights) =>
    typeof r[k] === "number" && (r[k] as number) >= 0
      ? (r[k] as number)
      : DEFAULT_WEIGHTS[k];
  return {
    rating: get("rating"),
    popular: get("popular"),
    promo: get("promo"),
    distance: get("distance"),
    open: get("open"),
  };
}
