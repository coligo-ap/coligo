import { createClient } from "@/lib/supabase/server";
import { normalizeOpeningHours } from "@/lib/merchant/opening-hours";
import type { OpeningHours } from "@/lib/types";

export type PublicMerchant = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description_fr: string | null;
  description_ar: string | null;
  logo_url: string | null;
  cover_url: string | null;
  phone_public: string | null;
  city: string | null;
  commune: string | null;
  wilaya_code: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  opening_hours: OpeningHours;
  min_order_da: number;
  prep_time_min: number;
  accepts_cash: boolean;
  accepts_online: boolean;
  pickup_slot_minutes: number;
  max_orders_per_slot: number | null;
  max_days_ahead: number;
  is_active: boolean;
  rating_avg: number;
  rating_count: number;
  delivery_enabled: boolean;
  express_enabled: boolean;
  tours_enabled: boolean;
  delivery_radius_km: number | null;
  /** Verrous de pause / fermeture (cf. lib/merchant/pause-state). */
  orders_paused: boolean;
  paused_until: string | null;
  closure_start: string | null;
  closure_end: string | null;
  /** Sous-spécialités du commerçant (volet 1 — recherche/filtres). */
  tags: string[];
  /** Scores pré-calculés (volet 3 — classement). 0..1. */
  score_quality: number;
  score_speed: number;
  avg_prep_min: number | null;
  orders_count: number;
};

type Filters = {
  wilaya_code?: string | null;
  commune?: string | null;
  q?: string | null;
  category?: string | null;
  /** Filtres livraison. */
  delivery_enabled?: boolean | null;
  delivery_mode?: "express" | "tour" | null;
  /** Tri MVP : "name" (par défaut), "min_order" asc. */
  sort?: "name" | "min_order";
  limit?: number;
  /**
   * Position COURANTE du client (GPS). Si fournie (et pas de recherche texte ni
   * tri prix), on bascule sur le chemin « proximité » : filtre par rayon réel
   * autour du client, trié du plus proche au plus loin. C'est le critère
   * géographique PRINCIPAL (cf. RPC merchants_nearby, mig 0181).
   */
  latitude?: number | null;
  longitude?: number | null;
};

/**
 * Renvoie les vitrines accessibles publiquement (vue `merchants_public`).
 * Lecture anon — pas d'auth requise.
 */
export async function listPublicMerchants(
  filters: Filters = {}
): Promise<PublicMerchant[]> {
  const supabase = await createClient();

  // Chemin PROXIMITÉ : position GPS connue, pas de recherche texte ni de tri
  // explicite par prix → on classe par distance réelle (critère principal).
  const hasGps =
    typeof filters.latitude === "number" &&
    typeof filters.longitude === "number" &&
    Number.isFinite(filters.latitude) &&
    Number.isFinite(filters.longitude);
  if (
    hasGps &&
    !(filters.q && filters.q.trim()) &&
    filters.sort !== "min_order"
  ) {
    return listNearbyMerchants(supabase, filters);
  }

  let query = supabase
    .from("merchants_public")
    .select("*")
    .limit(filters.limit ?? 60);

  if (filters.wilaya_code) {
    query = query.eq("wilaya_code", filters.wilaya_code);
  }
  if (filters.commune) {
    query = query.ilike("commune", filters.commune);
  }
  if (filters.category) {
    query = query.ilike("category", `%${filters.category}%`);
  }
  // Recherche texte FLOUE : on passe par search_merchants (trigram f_unaccent
  // bidirectionnel — tolère fautes/accents/« nom + ville ») pour des IDs classés
  // par pertinence, puis on hydrate les vitrines. Repli ilike si la RPC ne
  // renvoie rien (commerce sans coordonnées, ou match sur la description).
  let rankedIds: string[] | null = null;
  if (filters.q && filters.q.trim()) {
    rankedIds = await rankedMerchantIds(
      supabase,
      filters.q.trim(),
      40,
      hasGps ? filters.latitude! : null,
      hasGps ? filters.longitude! : null
    );
    if (rankedIds.length) {
      query = query.in("id", rankedIds);
    } else {
      const q = `%${filters.q.trim()}%`;
      query = query.or(
        [
          `name.ilike.${q}`,
          `description_fr.ilike.${q}`,
          `category.ilike.${q}`,
        ].join(",")
      );
    }
  }
  if (filters.delivery_enabled === true) {
    query = query.eq("delivery_enabled", true);
  }
  if (filters.delivery_mode === "express") {
    query = query.eq("delivery_enabled", true).eq("express_enabled", true);
  }
  if (filters.delivery_mode === "tour") {
    query = query.eq("delivery_enabled", true).eq("tours_enabled", true);
  }
  // Tri : pertinence floue si recherche active, sinon nom / minimum de commande.
  if (!rankedIds?.length) {
    query = query.order(filters.sort === "min_order" ? "min_order_da" : "name");
  }

  const { data } = await query;
  let rows = (data ?? []).map(toPublicMerchant);
  if (rankedIds?.length) {
    const pos = new Map(rankedIds.map((id, i) => [id, i]));
    rows = rows.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  }
  return rows;
}

/** IDs de commerces classés par pertinence floue (RPC search_merchants). */
async function rankedMerchantIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  q: string,
  limit: number,
  lat: number | null = null,
  lng: number | null = null
): Promise<string[]> {
  try {
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>;
    const { data } = await rpc("search_merchants", {
      p_q: q,
      p_lat: lat,
      p_lng: lng,
      p_limit: limit,
    });
    return ((data as { id: string }[] | null) ?? []).map((r) => r.id);
  } catch {
    return [];
  }
}

/**
 * Chemin PROXIMITÉ : commerces dans le rayon GPS autour du client, du plus
 * proche au plus loin (RPC merchants_nearby, mig 0181). On hydrate la vitrine
 * via merchants_public puis on réordonne par distance. Les filtres
 * catégorie/livraison restent appliqués ; la wilaya/commune est ignorée car le
 * GPS est le critère géographique. Expansion auto si rien dans le rayon
 * configuré → on ne montre JAMAIS une page vide quand des commerces existent.
 */
async function listNearbyMerchants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filters: Filters
): Promise<PublicMerchant[]> {
  const lat = filters.latitude as number;
  const lng = filters.longitude as number;
  const limit = filters.limit ?? 60;

  let near = await nearbyMerchantIds(supabase, lat, lng, limit, null);
  if (near.length === 0) {
    // Rien dans le rayon configuré → on élargit (300 km ≈ toute la zone) pour
    // toujours proposer le plus proche disponible, trié par distance.
    near = await nearbyMerchantIds(supabase, lat, lng, limit, 300);
  }
  if (near.length === 0) return [];

  const ids = near.map((n) => n.id);
  const distById = new Map(near.map((n) => [n.id, n.distance_km]));

  let query = supabase.from("merchants_public").select("*").in("id", ids);
  if (filters.category) {
    query = query.ilike("category", `%${filters.category}%`);
  }
  if (filters.delivery_enabled === true) {
    query = query.eq("delivery_enabled", true);
  }
  if (filters.delivery_mode === "express") {
    query = query.eq("delivery_enabled", true).eq("express_enabled", true);
  }
  if (filters.delivery_mode === "tour") {
    query = query.eq("delivery_enabled", true).eq("tours_enabled", true);
  }

  const { data } = await query;
  const rows = (data ?? []).map(toPublicMerchant);
  // Réordonne par distance croissante (le .in() ne garantit pas l'ordre).
  rows.sort(
    (a, b) =>
      (distById.get(a.id) ?? Infinity) - (distById.get(b.id) ?? Infinity)
  );
  return rows;
}

/** (id, distance_km) des commerces dans le rayon, du plus proche au plus loin. */
async function nearbyMerchantIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lat: number,
  lng: number,
  limit: number,
  radiusOverride: number | null
): Promise<{ id: string; distance_km: number }[]> {
  try {
    // ⚠️ Toujours .bind(supabase) — extraire rpc sans bind casse this.rest.
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>;
    const { data } = await rpc("merchants_nearby", {
      p_lat: lat,
      p_lng: lng,
      p_limit: limit,
      p_radius_override: radiusOverride,
    });
    return ((data as { id: string; distance_km: number }[] | null) ?? []).map(
      (r) => ({ id: r.id, distance_km: Number(r.distance_km) })
    );
  } catch {
    return [];
  }
}

/** Vitrines publiques pour une liste d'IDs (ordre non garanti). Sert à la page
 *  « Mes favoris » qui part d'une liste de merchant_ids. */
export async function listPublicMerchantsByIds(
  ids: string[]
): Promise<PublicMerchant[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("merchants_public")
    .select("*")
    .in("id", ids);
  return (data ?? []).map(toPublicMerchant);
}

export async function getPublicMerchantBySlug(
  slug: string
): Promise<PublicMerchant | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("merchants_public")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return data ? toPublicMerchant(data) : null;
}

/**
 * Renvoie l'ensemble des merchant_ids qui ont AU MOINS une promotion active
 * (status='active', dans la fenêtre temporelle). Utilisé pour afficher le
 * badge PROMO sur les cartes commerce et alimenter le carrousel « Populaires ».
 */
export async function listMerchantIdsWithActivePromo(
  merchantIds?: string[]
): Promise<Set<string>> {
  const supabase = await createClient();
  let query = supabase
    .from("promotions")
    .select("merchant_id")
    .eq("status", "active");
  if (merchantIds && merchantIds.length > 0) {
    query = query.in("merchant_id", merchantIds);
  }
  const { data } = await query;
  return new Set((data ?? []).map((r) => r.merchant_id as string));
}

/**
 * Étiquette promo « marketing » prête à afficher sur une carte commerce.
 *  - kind sert à choisir la couleur ; text est le libellé court.
 */
export type PromoLabel = { text: string; kind: "discount" | "code" | "offer" };

type PromoRow = {
  merchant_id: string;
  type: "product_discount" | "promo_code" | "quantity_offer";
  discount_kind: "percent" | "amount" | null;
  discount_value: number | null;
  code: string | null;
  buy_qty: number | null;
  get_qty: number | null;
};

/** Construit un libellé court + un score d'attractivité pour CHOISIR la
 *  meilleure promo à mettre en avant par commerçant. */
function promoToLabel(p: PromoRow): { label: PromoLabel; appeal: number } {
  // discount_value arrive en NUMERIC → string côté JS. On coerce + arrondit.
  const val =
    p.discount_value != null ? Math.round(Number(p.discount_value)) : 0;
  if (p.type === "quantity_offer" && p.buy_qty && p.get_qty) {
    return {
      label: {
        text: `${p.buy_qty} achetés = ${p.get_qty} offert${p.get_qty > 1 ? "s" : ""}`,
        kind: "offer",
      },
      appeal: 60 + p.get_qty,
    };
  }
  if (p.type === "promo_code") {
    const v = val
      ? p.discount_kind === "percent"
        ? ` −${val}%`
        : ` −${val} DA`
      : "";
    return {
      label: { text: `Code promo${v}`, kind: "code" },
      appeal: 40 + (p.discount_kind === "percent" ? val : 0),
    };
  }
  // product_discount
  if (p.discount_kind === "percent" && val) {
    return {
      label: { text: `−${val}%`, kind: "discount" },
      appeal: 100 + val,
    };
  }
  if (p.discount_kind === "amount" && val) {
    return {
      label: { text: `−${val} DA`, kind: "discount" },
      appeal: 80 + Math.min(val, 50),
    };
  }
  return { label: { text: "Promo", kind: "discount" }, appeal: 10 };
}

/**
 * Renvoie, par commerçant, l'étiquette de la promo la PLUS attractive active.
 * Utilisé pour mettre en avant les promotions sur les cartes marketplace.
 */
export async function getPromoLabelsByMerchant(
  merchantIds?: string[]
): Promise<Record<string, PromoLabel>> {
  const supabase = await createClient();
  let query = supabase
    .from("promotions")
    .select(
      "merchant_id, type, discount_kind, discount_value, code, buy_qty, get_qty"
    )
    .eq("status", "active");
  if (merchantIds && merchantIds.length > 0) {
    query = query.in("merchant_id", merchantIds);
  }
  const { data } = await query;

  const best = new Map<string, { label: PromoLabel; appeal: number }>();
  for (const row of (data ?? []) as PromoRow[]) {
    const cur = promoToLabel(row);
    const prev = best.get(row.merchant_id);
    if (!prev || cur.appeal > prev.appeal) best.set(row.merchant_id, cur);
  }
  const out: Record<string, PromoLabel> = {};
  for (const [mid, v] of best) out[mid] = v.label;
  return out;
}

/** Liste les catégories distinctes parmi les vitrines actives. */
export async function listMerchantCategories(): Promise<
  { name: string; count: number }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("merchants_public")
    .select("category")
    .not("category", "is", null);
  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    if (!r.category) continue;
    const cat = r.category.trim();
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

// `merchants_public.opening_hours` est un Json générique → on le normalise.
function toPublicMerchant(row: Record<string, unknown>): PublicMerchant {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    category: (row.category as string | null) ?? null,
    description_fr: (row.description_fr as string | null) ?? null,
    description_ar: (row.description_ar as string | null) ?? null,
    logo_url: (row.logo_url as string | null) ?? null,
    cover_url: (row.cover_url as string | null) ?? null,
    phone_public: (row.phone_public as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    commune: (row.commune as string | null) ?? null,
    wilaya_code: (row.wilaya_code as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    latitude: (row.latitude as number | null) ?? null,
    longitude: (row.longitude as number | null) ?? null,
    opening_hours: normalizeOpeningHours(
      row.opening_hours as Partial<OpeningHours> | null
    ),
    min_order_da: (row.min_order_da as number | null) ?? 0,
    prep_time_min: (row.prep_time_min as number | null) ?? 0,
    accepts_cash: (row.accepts_cash as boolean | null) ?? true,
    accepts_online: (row.accepts_online as boolean | null) ?? false,
    pickup_slot_minutes: (row.pickup_slot_minutes as number | null) ?? 15,
    max_orders_per_slot: (row.max_orders_per_slot as number | null) ?? null,
    max_days_ahead: (row.max_days_ahead as number | null) ?? 7,
    is_active: (row.is_active as boolean | null) ?? true,
    // rating_avg vient en NUMERIC depuis Postgres → string côté JS. On parse.
    rating_avg:
      typeof row.rating_avg === "string"
        ? parseFloat(row.rating_avg)
        : ((row.rating_avg as number | null) ?? 0),
    rating_count: (row.rating_count as number | null) ?? 0,
    delivery_enabled: (row.delivery_enabled as boolean | null) ?? false,
    express_enabled: (row.express_enabled as boolean | null) ?? false,
    tours_enabled: (row.tours_enabled as boolean | null) ?? false,
    delivery_radius_km:
      typeof row.delivery_radius_km === "string"
        ? parseFloat(row.delivery_radius_km)
        : ((row.delivery_radius_km as number | null) ?? null),
    orders_paused: (row.orders_paused as boolean | null) ?? false,
    paused_until: (row.paused_until as string | null) ?? null,
    closure_start: (row.closure_start as string | null) ?? null,
    closure_end: (row.closure_end as string | null) ?? null,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    score_quality: numOr(row.score_quality, 0.5),
    score_speed: numOr(row.score_speed, 0.5),
    avg_prep_min: row.avg_prep_min == null ? null : numOr(row.avg_prep_min, 0),
    orders_count: (row.orders_count as number | null) ?? 0,
  };
}

/** Parse un NUMERIC Postgres (string|number|null) en number, avec défaut. */
function numOr(v: unknown, fallback: number): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}
