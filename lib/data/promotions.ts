import { createClient } from "@/lib/supabase/server";
import { getCurrentMerchantId } from "@/lib/auth/merchant";
import type { PromotionWithProducts } from "@/lib/types";

const PROMO_COLUMNS = `id, merchant_id, type, title_fr, title_ar, status,
  discount_kind, discount_value, code, buy_qty, get_qty, gift_label, starts_at, ends_at,
  max_uses, max_uses_per_customer, min_subtotal_da, uses_count, created_at,
  promotion_products ( product_id )`;

/**
 * Promotions du commerçant connecté, récentes d'abord. IMPORTANT : filtrer
 * EXPLICITEMENT par merchant_id — `promotions` a une policy SELECT publique
 * (`promotions_select_public_active`, pour la vitrine client), donc sans ce
 * filtre la liste remontait les promos actives de TOUTES les boutiques. Même
 * piège que getMerchantProductsLite ci-dessous.
 */
export async function getMerchantPromotions(): Promise<
  PromotionWithProducts[]
> {
  const merchantId = await getCurrentMerchantId();
  if (!merchantId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("promotions")
    .select(PROMO_COLUMNS)
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false });
  return (data ?? []) as PromotionWithProducts[];
}

/**
 * Une promotion DU commerçant connecté (ou null). On filtre par merchant_id :
 * la RLS publique laisserait sinon lire/éditer la promo d'une autre boutique
 * via son id. Un id étranger ⇒ null (→ notFound côté page).
 */
export async function getPromotion(
  id: string
): Promise<PromotionWithProducts | null> {
  const merchantId = await getCurrentMerchantId();
  if (!merchantId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("promotions")
    .select(PROMO_COLUMNS)
    .eq("id", id)
    .eq("merchant_id", merchantId)
    .maybeSingle();
  return (data as PromotionWithProducts | null) ?? null;
}

export type ProductLite = {
  id: string;
  name_fr: string;
  price_da: number;
};

/**
 * Produits DU commerçant connecté (champs légers) pour la sélection dans une
 * promo. IMPORTANT : filtrer explicitement par merchant_id — le RLS des produits
 * autorise la lecture publique (catalogue client), donc sans ce filtre la liste
 * exposait les produits d'AUTRES boutiques (→ promo liée à un produit d'une autre
 * boutique, invisible côté client). Backstop DB : trigger mig 0260.
 */
export async function getMerchantProductsLite(): Promise<ProductLite[]> {
  const merchantId = await getCurrentMerchantId();
  if (!merchantId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("id, name_fr, price_da")
    .eq("merchant_id", merchantId)
    .order("name_fr", { ascending: true });
  return (data ?? []) as ProductLite[];
}
