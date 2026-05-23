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
};

type Filters = {
  wilaya_code?: string | null;
  commune?: string | null;
  q?: string | null;
  category?: string | null;
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
  };
}
