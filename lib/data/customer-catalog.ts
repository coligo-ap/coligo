import { createClient } from "@/lib/supabase/server";

// =============================================================================
// Lecture PUBLIQUE (anon) du catalogue d'un commerçant. RLS via 0016 :
// produits/catégories/promotions visibles uniquement pour les commerces actifs.
// =============================================================================

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
  is_available: boolean;
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
  type: "product_discount" | "promo_code" | "quantity_offer";
  status: "scheduled" | "active" | "expired" | "disabled";
  discount_kind: "percent" | "amount" | null;
  discount_value: number | null;
  code: string | null;
  buy_qty: number | null;
  get_qty: number | null;
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
        "id, merchant_id, name_fr, name_ar, description_fr, description_ar, price_da, unit, category, category_id, image_url, stock_qty, is_available, position"
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
    products: (products ?? []) as unknown as PublicProduct[],
  };
}

/** Liste les promotions actives d'un commerce, avec leurs produits liés. */
export async function listMerchantPromotions(
  merchantId: string
): Promise<PublicPromotion[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("promotions")
    .select(
      `id, merchant_id, type, status, discount_kind, discount_value, code,
       buy_qty, get_qty, starts_at, ends_at,
       promotion_products ( product_id )`
    )
    .eq("merchant_id", merchantId)
    .eq("status", "active");

  return ((data ?? []) as unknown as RawPromo[]).map((row) => ({
    id: row.id,
    merchant_id: row.merchant_id,
    type: row.type,
    status: row.status,
    discount_kind: row.discount_kind,
    discount_value: row.discount_value,
    code: row.code,
    buy_qty: row.buy_qty,
    get_qty: row.get_qty,
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
  discount_kind: PublicPromotion["discount_kind"];
  discount_value: number | null;
  code: string | null;
  buy_qty: number | null;
  get_qty: number | null;
  starts_at: string | null;
  ends_at: string | null;
  promotion_products: { product_id: string }[];
};
