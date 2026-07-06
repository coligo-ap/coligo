import { createClient } from "@/lib/supabase/server";

// =============================================================================
// Lecture PUBLIQUE (anon) du catalogue d'un commerçant. RLS via 0016 :
// produits/catégories/promotions visibles uniquement pour les commerces actifs.
// =============================================================================

export type PublicOption = {
  id: string;
  name_fr: string;
  name_ar: string | null;
  price_delta_da: number;
};

export type PublicOptionGroup = {
  id: string;
  name_fr: string;
  name_ar: string | null;
  min_select: number;
  max_select: number;
  options: PublicOption[];
};

export type PublicProduct = {
  id: string;
  merchant_id: string;
  name_fr: string;
  name_ar: string | null;
  description_fr: string | null;
  description_ar: string | null;
  price_da: number;
  unit: string;
  category: string | null;
  category_id: string | null;
  image_url: string | null;
  stock_qty: number | null;
  /** Quantité min par ligne / max par commande, fixées par le commerçant. */
  min_qty: number | null;
  max_qty: number | null;
  is_available: boolean;
  /** Groupes d'options/variantes (absent/vide pour un produit simple). */
  option_groups?: PublicOptionGroup[];
};

export type PublicCategory = {
  id: string;
  merchant_id: string;
  title: string;
  image_url: string | null;
  position: number;
};

export type PublicPromotion = {
  id: string;
  merchant_id: string;
  type:
    | "product_discount"
    | "promo_code"
    | "quantity_offer"
    | "free_gift"
    | "free_delivery";
  status: "scheduled" | "active" | "expired" | "disabled";
  title_fr: string;
  title_ar: string | null;
  discount_kind: "percent" | "amount" | null;
  discount_value: number | null;
  code: string | null;
  buy_qty: number | null;
  get_qty: number | null;
  gift_label: string | null;
  min_subtotal_da: number | null;
  starts_at: string | null;
  ends_at: string | null;
  product_ids: string[];
};

/**
 * Liste les produits d'un commerce, groupés par catégorie pour l'affichage.
 */
export async function listMerchantProducts(
  merchantId: string
): Promise<{ categories: PublicCategory[]; products: PublicProduct[] }> {
  const supabase = await createClient();

  const [{ data: products }, { data: categories }] = await Promise.all([
    supabase
      .from("products")
      .select(
        `id, merchant_id, name_fr, name_ar, description_fr, description_ar,
         price_da, unit, category, category_id, image_url, stock_qty,
         min_qty, max_qty, is_available, position,
         product_option_groups (
           id, name_fr, name_ar, min_select, max_select, position,
           product_options ( id, name_fr, name_ar, price_delta_da, is_available, position )
         )`
      )
      .eq("merchant_id", merchantId)
      .eq("is_available", true)
      .order("position", { ascending: true }),
    supabase
      .from("categories")
      .select("id, merchant_id, title, image_url, position")
      .eq("merchant_id", merchantId)
      .order("position", { ascending: true }),
  ]);

  return {
    categories: (categories ?? []) as PublicCategory[],
    products: ((products ?? []) as unknown as RawProductRow[]).map(
      normalizeProduct
    ),
  };
}

type RawProductRow = Omit<PublicProduct, "option_groups"> & {
  product_option_groups: {
    id: string;
    name_fr: string;
    name_ar: string | null;
    min_select: number;
    max_select: number;
    position: number;
    product_options: {
      id: string;
      name_fr: string;
      name_ar: string | null;
      price_delta_da: number;
      is_available: boolean;
      position: number;
    }[];
  }[];
};

/** Normalise la jointure imbriquée → PublicProduct (options dispo triées). */
function normalizeProduct(p: RawProductRow): PublicProduct {
  const { product_option_groups, ...rest } = p;
  const option_groups: PublicOptionGroup[] = (product_option_groups ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((g) => ({
      id: g.id,
      name_fr: g.name_fr,
      name_ar: g.name_ar,
      min_select: g.min_select,
      max_select: g.max_select,
      options: (g.product_options ?? [])
        .filter((o) => o.is_available)
        .sort((a, b) => a.position - b.position)
        .map((o) => ({
          id: o.id,
          name_fr: o.name_fr,
          name_ar: o.name_ar,
          price_delta_da: o.price_delta_da,
        })),
    }))
    // Un groupe sans option disponible n'a pas à s'afficher.
    .filter((g) => g.options.length > 0);
  return { ...rest, option_groups };
}

/** Liste les promotions actives d'un commerce, avec leurs produits liés. */
export async function listMerchantPromotions(
  merchantId: string
): Promise<PublicPromotion[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("promotions")
    .select(
      `id, merchant_id, type, status, title_fr, title_ar, discount_kind,
       discount_value, code, buy_qty, get_qty, gift_label, min_subtotal_da,
       starts_at, ends_at, promotion_products ( product_id )`
    )
    .eq("merchant_id", merchantId)
    .eq("status", "active");

  return ((data ?? []) as unknown as RawPromo[]).map((row) => ({
    id: row.id,
    merchant_id: row.merchant_id,
    type: row.type,
    status: row.status,
    title_fr: row.title_fr,
    title_ar: row.title_ar,
    discount_kind: row.discount_kind,
    discount_value: row.discount_value,
    code: row.code,
    buy_qty: row.buy_qty,
    get_qty: row.get_qty,
    gift_label: row.gift_label,
    min_subtotal_da: row.min_subtotal_da,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    product_ids: (row.promotion_products ?? []).map((p) => p.product_id),
  }));
}

type RawPromo = {
  id: string;
  merchant_id: string;
  type: PublicPromotion["type"];
  status: PublicPromotion["status"];
  title_fr: string;
  title_ar: string | null;
  discount_kind: PublicPromotion["discount_kind"];
  discount_value: number | null;
  code: string | null;
  buy_qty: number | null;
  get_qty: number | null;
  gift_label: string | null;
  min_subtotal_da: number | null;
  starts_at: string | null;
  ends_at: string | null;
  promotion_products: { product_id: string }[];
};
