import { createClient } from "@/lib/supabase/server";
import type { PromotionWithProducts } from "@/lib/types";

const PROMO_COLUMNS = `id, merchant_id, type, title_fr, title_ar, status,
  discount_kind, discount_value, code, buy_qty, get_qty, starts_at, ends_at,
  max_uses, max_uses_per_customer, uses_count, created_at,
  promotion_products ( product_id )`;

/** Promotions du commerçant connecté (RLS = ses données), récentes d'abord. */
export async function getMerchantPromotions(): Promise<
  PromotionWithProducts[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("promotions")
    .select(PROMO_COLUMNS)
    .order("created_at", { ascending: false });
  return (data ?? []) as PromotionWithProducts[];
}

/** Une promotion du commerçant (ou null). RLS = sécurité. */
export async function getPromotion(
  id: string
): Promise<PromotionWithProducts | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("promotions")
    .select(PROMO_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  return (data as PromotionWithProducts | null) ?? null;
}

export type ProductLite = {
  id: string;
  name_fr: string;
  price_da: number;
};

/** Produits du commerçant (champs légers) pour la sélection dans une promo. */
export async function getMerchantProductsLite(): Promise<ProductLite[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("id, name_fr, price_da")
    .order("name_fr", { ascending: true });
  return (data ?? []) as ProductLite[];
}
