"use server";

import { createClient } from "@/lib/supabase/server";
import { computeCart, type EnginePromotion } from "@/lib/promotions/engine";
import { APP_CONFIG } from "@/lib/config/app-config";
import { getMyCashbackBalance } from "@/lib/customer/cashback";
import type { Json } from "@/lib/supabase/database.types";

export type CheckoutContextInput = {
  merchant_id: string;
  items: { product_id: string; quantity: number }[];
};

export type CheckoutContext = {
  error?: string;
  merchant: {
    id: string;
    name: string;
    accepts_cash: boolean;
    accepts_online: boolean;
    opening_hours: Json;
    min_order_da: number;
    prep_time_min: number;
    pickup_slot_minutes: number;
  };
  lines: {
    product_id: string;
    name: string;
    quantity: number;
    unit_price_da: number;
    line_total_da: number;
  }[];
  cart: {
    subtotalDa: number;
    totalDa: number;
    savingsDa: number;
  };
  /** Solde cashback disponible (DA) du client connecté — 0 si non connecté. */
  cashback_balance_da: number;
};

/**
 * Re-calcule côté serveur le récap du panier pour le checkout, sans rien créer.
 * Source de vérité : prix DB + moteur promo. Le client ne décide pas du prix.
 */
export async function fetchCheckoutContext(
  input: CheckoutContextInput
): Promise<CheckoutContext> {
  const supabase = await createClient();

  const { data: merchant } = await supabase
    .from("merchants_public")
    .select(
      "id, name, accepts_cash, accepts_online, opening_hours, min_order_da, prep_time_min, pickup_slot_minutes"
    )
    .eq("id", input.merchant_id)
    .maybeSingle();

  // Solde cashback du client connecté (en parallèle, lecture rapide).
  const cashbackBalance = await getMyCashbackBalance();

  const fallback = {
    merchant: {
      id: input.merchant_id,
      name: "",
      accepts_cash: true,
      accepts_online: false,
      opening_hours: {},
      min_order_da: 0,
      prep_time_min: 15,
      pickup_slot_minutes: 15,
    },
    lines: [],
    cart: { subtotalDa: 0, totalDa: 0, savingsDa: 0 },
    cashback_balance_da: cashbackBalance,
  };

  if (!merchant) {
    return { ...fallback, error: "Ce commerce n'est plus disponible." };
  }

  const productIds = input.items.map((i) => i.product_id);
  const { data: products } = await supabase
    .from("products")
    .select("id, merchant_id, name_fr, price_da, is_available")
    .in("id", productIds);

  if (!products || products.length === 0) {
    return {
      ...fallback,
      merchant: { ...fallback.merchant, ...merchant },
      error: "Le panier est vide ou les produits ne sont plus disponibles.",
    };
  }

  const { data: promosRaw } = await supabase
    .from("promotions")
    .select(
      `id, type, status, discount_kind, discount_value, code,
       buy_qty, get_qty, starts_at, ends_at,
       promotion_products ( product_id )`
    )
    .eq("merchant_id", merchant.id)
    .eq("status", "active");

  const promotions: EnginePromotion[] = (
    (promosRaw ?? []) as unknown as {
      id: string;
      type: EnginePromotion["type"];
      status: EnginePromotion["status"];
      discount_kind: EnginePromotion["discountKind"];
      discount_value: number | null;
      code: string | null;
      buy_qty: number | null;
      get_qty: number | null;
      starts_at: string | null;
      ends_at: string | null;
      promotion_products: { product_id: string }[];
    }[]
  ).map((p) => ({
    id: p.id,
    type: p.type,
    status: p.status,
    discountKind: p.discount_kind,
    discountValue: p.discount_value,
    code: p.code,
    buyQty: p.buy_qty,
    getQty: p.get_qty,
    productIds: (p.promotion_products ?? []).map((x) => x.product_id),
    startsAt: p.starts_at,
    endsAt: p.ends_at,
  }));

  const lines = input.items
    .map((it) => {
      const p = products.find((pp) => pp.id === it.product_id);
      if (!p || !p.is_available) return null;
      return {
        productId: it.product_id,
        quantity: it.quantity,
        unitPriceDa: p.price_da,
      };
    })
    .filter(
      (l): l is { productId: string; quantity: number; unitPriceDa: number } =>
        !!l
    );

  const settled = computeCart(lines, promotions, {
    minPriceDa: APP_CONFIG.promotions.minPriceDa,
    commissionRate: APP_CONFIG.commission.rate,
  });

  return {
    merchant: {
      id: merchant.id,
      name: merchant.name,
      accepts_cash: merchant.accepts_cash,
      accepts_online: merchant.accepts_online,
      opening_hours: merchant.opening_hours,
      min_order_da: merchant.min_order_da,
      prep_time_min: merchant.prep_time_min,
      pickup_slot_minutes: merchant.pickup_slot_minutes,
    },
    lines: settled.lines.map((l) => {
      const product = products.find((p) => p.id === l.productId)!;
      return {
        product_id: l.productId,
        name: product.name_fr,
        quantity: l.quantity,
        unit_price_da: l.appliedUnitPriceDa,
        line_total_da: l.lineTotalDa,
      };
    }),
    cart: {
      subtotalDa: settled.subtotalDa,
      totalDa: settled.totalDa,
      savingsDa: settled.savingsDa,
    },
    cashback_balance_da: cashbackBalance,
  };
}
