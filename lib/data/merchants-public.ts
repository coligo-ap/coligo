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
  is_active: boolean;
  rating_avg: number;
  rating_count: number;
  delivery_enabled: boolean;
  express_enabled: boolean;
  tours_enabled: boolean;
  delivery_radius_km: number | null;
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
};

/**
 * Renvoie les vitrines accessibles publiquement (vue `merchants_public`).
 * Lecture anon — pas d'auth requise.
 */
export async function listPublicMerchants(
  filters: Filters = {}
): Promise<PublicMerchant[]> {
  const supabase = await createClient();
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
  if (filters.q && filters.q.trim()) {
    const q = `%${filters.q.trim()}%`;
    query = query.or(
      [
        `name.ilike.${q}`,
        `description_fr.ilike.${q}`,
        `category.ilike.${q}`,
      ].join(",")
    );
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
  query = query.order(filters.sort === "min_order" ? "min_order_da" : "name");

  const { data } = await query;
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
  };
}
