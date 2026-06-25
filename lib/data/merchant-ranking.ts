// =============================================================================
// Algorithme de classement des commerçants — score composite déterministe.
// =============================================================================
// Signaux (poids ajustables) :
//   - rating   (note moyenne) ........ poids 30 %
//   - popular  (commandes 30j) ....... poids 25 %
//   - promo    (promo active) ........ poids 15 %
//   - distance (proximité GPS) ....... poids 35 %  (si lat/lng client connu)
//   - open     (ouvert maintenant) ... poids 10 %  (Africa/Algiers)
//   - favorite (contexte client) ..... poids 15 %  (UNIQUEMENT si le client a
//                des favoris — sinon le signal est totalement neutralisé : un
//                client sans favoris est classé EXACTEMENT comme avant)
//
// Le score final est dans [0, 1]. Formule explicite, signaux authentiques
// (non manipulables côté client : tous viennent de la DB sauf la position
// du client qu'on utilise uniquement pour la distance, et ses favoris).
//
// Les poids sont configurables via platform_settings.ranking_weights (JSONB)
// si présent. Si absent, on tombe sur DEFAULT_WEIGHTS.
//
// ⚠️ ENRICHISSEMENT CONTRÔLÉ (sans remplacer la base) : un signal n'entre dans
// la composition QUE si sa donnée est disponible (distance ⇢ coords client,
// favorite ⇢ au moins un favori). Le poids des signaux absents est redistribué
// proportionnellement → aucune régression pour les sessions sans coords/favori.
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { isOpenNow, nowInAlgiers } from "@/lib/merchant/opening-hours";
import { getMyFavoriteIds } from "@/lib/data/favorites";
import type { PublicMerchant } from "@/lib/data/merchants-public";

export type RankingWeights = {
  rating: number;
  popular: number;
  promo: number;
  distance: number;
  open: number;
  favorite: number;
};

export const DEFAULT_WEIGHTS: RankingWeights = {
  rating: 0.3,
  popular: 0.25,
  promo: 0.15,
  // Distance = signal DOMINANT (proximité d'abord, façon Uber) mais pondéré :
  // un voisin médiocre ne passe plus systématiquement devant un excellent
  // commerce un peu plus loin. N'a d'effet que sur le chemin « unifié » (le
  // chemin legacy GPS trie par distance pure sans ce score).
  distance: 0.35,
  open: 0.1,
  favorite: 0.15,
};

export type RankingContext = {
  promoIds: Set<string>;
  orderCounts30d: Map<string, number>;
  customer: { latitude: number | null; longitude: number | null } | null;
  /** Favoris du client (contexte utilisateur) — vide si anon / aucun favori. */
  favoriteIds: Set<string>;
  weights: RankingWeights;
  /**
   * Drapeau « ranking unifié » (platform_settings.ranking_unified, mig 0261).
   * true → le score composite classe TOUS les chemins (GPS inclus). false
   * (défaut) → comportement legacy (distance pure quand le GPS est connu).
   */
  unified: boolean;
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
  /** Favoris du client (signal contexte). Optionnel → set vide par défaut. */
  favoriteIds?: Set<string>;
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
      .select("ranking_weights, ranking_unified")
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

  const settingsRow = settings.data as {
    ranking_weights?: unknown;
    ranking_unified?: boolean | null;
  } | null;
  const weights = parseWeights(settingsRow?.ranking_weights);

  return {
    promoIds,
    orderCounts30d,
    customer: opts.customer,
    favoriteIds: opts.favoriteIds ?? new Set(),
    weights,
    unified: settingsRow?.ranking_unified === true,
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

  // Signal 6 : favori du client (contexte utilisateur). N'entre dans la
  // composition QUE si le client a au moins un favori → un client sans favoris
  // a un score STRICTEMENT identique à l'algo d'origine (aucune régression).
  const hasFavoriteContext = ctx.favoriteIds.size > 0;
  const favorite = ctx.favoriteIds.has(merchant.id) ? 1 : 0;

  // Composition : on n'inclut un signal QUE si sa donnée existe (distance ⇢
  // coords, favorite ⇢ favoris), et on redistribue le poids des absents en
  // normalisant par la somme des poids RÉELLEMENT actifs.
  const parts: Array<[value: number, weight: number]> = [
    [rating, w.rating],
    [popular, w.popular],
    [promo, w.promo],
    [open, w.open],
  ];
  if (distance !== null) parts.push([distance, w.distance]);
  if (hasFavoriteContext) parts.push([favorite, w.favorite]);

  const total = parts.reduce((s, [, weight]) => s + weight, 0);
  if (total === 0) return 0;
  return parts.reduce((s, [value, weight]) => s + value * weight, 0) / total;
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

/**
 * Lecture SEULE du drapeau ranking unifié (1 read indexé sur le singleton).
 * Sert à court-circuiter sans charger tout le contexte de classement quand le
 * mode est OFF (le défaut) → le chemin legacy reste quasi gratuit.
 */
export async function isRankingUnified(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_settings")
    .select("ranking_unified")
    .eq("id", true)
    .maybeSingle();
  return (
    (data as { ranking_unified?: boolean } | null)?.ranking_unified === true
  );
}

/**
 * Applique le classement composite À CONDITION que le ranking unifié soit
 * activé (platform_settings.ranking_unified). Sinon, renvoie la liste TELLE
 * QUELLE (ordre déjà décidé par l'appelant : proximité côté serveur, nom, etc.)
 * → zéro régression quand le drapeau est OFF.
 *
 * Pensé pour le refetch côté client (`fetchMerchantsForZone`) : il faut que la
 * liste rafraîchie suive le MÊME ordre que le SSR quand le mode unifié est ON.
 * Les favoris (contexte) sont chargés ICI, et seulement si le mode est actif.
 */
export async function rankMerchantsIfUnified(
  merchants: PublicMerchant[],
  opts: {
    customer: { latitude: number | null; longitude: number | null } | null;
    favoriteIds?: Set<string>;
  }
): Promise<{ merchants: PublicMerchant[]; unified: boolean }> {
  if (merchants.length === 0) return { merchants, unified: false };
  // Court-circuit OFF : 1 seule lecture, aucun chargement de contexte.
  if (!(await isRankingUnified())) return { merchants, unified: false };

  const favoriteIds = opts.favoriteIds ?? (await getMyFavoriteIds());
  const ctx = await loadRankingContext({
    merchantIds: merchants.map((m) => m.id),
    customer: opts.customer,
    favoriteIds,
  });
  return { merchants: rankMerchants(merchants, ctx), unified: true };
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
    favorite: get("favorite"),
  };
}
