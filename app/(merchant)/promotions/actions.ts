"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMerchantId } from "@/lib/auth/merchant";
import {
  parsePromotionForm,
  type PromotionInput,
} from "@/lib/validation/promotion";
import type { Database } from "@/lib/supabase/database.types";
import type { PromotionStatus } from "@/lib/types";
import { notifyCustomersPromo } from "@/lib/fcm/triggers";

export type PromotionFormState = {
  error?: string;
  ok?: boolean;
};

type PromotionInsert = Database["public"]["Tables"]["promotions"]["Insert"];

/** Construit la ligne `promotions` + la liste des produits liés selon le type. */
function buildRow(data: PromotionInput): {
  row: Omit<PromotionInsert, "merchant_id">;
  productIds: string[];
} {
  const base = {
    type: data.type,
    title_fr: data.title_fr,
    title_ar: data.title_ar,
    starts_at: data.starts_at,
    ends_at: data.ends_at,
  };

  switch (data.type) {
    case "product_discount":
      return {
        row: {
          ...base,
          discount_kind: data.discount_kind,
          discount_value: data.discount_value,
        },
        productIds: data.product_ids,
      };
    case "promo_code":
      return {
        row: {
          ...base,
          discount_kind: data.discount_kind,
          discount_value: data.discount_value,
          code: data.code,
          max_uses: data.max_uses,
          max_uses_per_customer: data.max_uses_per_customer,
        },
        productIds: [],
      };
    case "quantity_offer":
      return {
        row: {
          ...base,
          buy_qty: data.buy_qty,
          get_qty: data.get_qty,
        },
        productIds: data.product_ids,
      };
  }
}

function friendlyError(message: string): string {
  if (message.includes("idx_promotions_merchant_code")) {
    return "Ce code promo existe déjà. Choisissez-en un autre.";
  }
  return message;
}

export async function createPromotion(
  _prevState: PromotionFormState,
  formData: FormData
): Promise<PromotionFormState> {
  const parsed = parsePromotionForm(formData);
  if (!parsed.success) return { error: parsed.error };

  const merchantId = await getCurrentMerchantId();
  if (!merchantId) return { error: "Session expirée, reconnectez-vous." };

  const { row, productIds } = buildRow(parsed.data);
  const supabase = await createClient();

  const { data: created, error } = await supabase
    .from("promotions")
    .insert({ merchant_id: merchantId, ...row })
    .select("id")
    .single();

  if (error || !created) {
    return { error: friendlyError(error?.message ?? "Échec de la création.") };
  }

  if (productIds.length > 0) {
    const { error: linkError } = await supabase
      .from("promotion_products")
      .insert(
        productIds.map((product_id) => ({
          promotion_id: created.id,
          product_id,
        }))
      );
    if (linkError) {
      // La promo est créée mais sans produits : on la supprime pour rester propre.
      await supabase.from("promotions").delete().eq("id", created.id);
      return { error: `Produits liés : ${linkError.message}` };
    }
  }

  // Promo active → prévient les clients qui ont mis la boutique en favori
  // (no-op si non active / pas de favoris / pas de tokens). Fire-and-forget.
  void notifyCustomersPromo({ promotionId: created.id });

  revalidatePath("/promotions");
  return { ok: true };
}

export async function updatePromotion(
  promotionId: string,
  _prevState: PromotionFormState,
  formData: FormData
): Promise<PromotionFormState> {
  const parsed = parsePromotionForm(formData);
  if (!parsed.success) return { error: parsed.error };

  const { row, productIds } = buildRow(parsed.data);
  const supabase = await createClient();

  const { error } = await supabase
    .from("promotions")
    .update(row)
    .eq("id", promotionId);

  if (error) return { error: friendlyError(error.message) };

  // Resynchronise les produits liés (remplacement complet).
  if (parsed.data.type !== "promo_code") {
    await supabase
      .from("promotion_products")
      .delete()
      .eq("promotion_id", promotionId);
    if (productIds.length > 0) {
      const { error: linkError } = await supabase
        .from("promotion_products")
        .insert(
          productIds.map((product_id) => ({
            promotion_id: promotionId,
            product_id,
          }))
        );
      if (linkError) return { error: `Produits liés : ${linkError.message}` };
    }
  }

  revalidatePath("/promotions");
  revalidatePath(`/promotions/${promotionId}`);
  return { ok: true };
}

/** Active <-> désactive une promotion (les autres statuts sont dérivés). */
export async function togglePromotion(
  promotionId: string,
  current: PromotionStatus
): Promise<{ error?: string }> {
  const next: PromotionStatus = current === "disabled" ? "active" : "disabled";
  const supabase = await createClient();
  const { error } = await supabase
    .from("promotions")
    .update({ status: next })
    .eq("id", promotionId);
  if (error) return { error: error.message };

  // Réactivation → on (re)prévient les clients favoris.
  if (next === "active") void notifyCustomersPromo({ promotionId });

  revalidatePath("/promotions");
  return {};
}

export async function deletePromotion(
  promotionId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  // promotion_products part en cascade (FK ON DELETE CASCADE).
  const { error } = await supabase
    .from("promotions")
    .delete()
    .eq("id", promotionId);
  if (error) return { error: error.message };

  revalidatePath("/promotions");
  return {};
}
