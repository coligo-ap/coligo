"use server";

import { createClient } from "@/lib/supabase/server";
import { computeCart, type EnginePromotion } from "@/lib/promotions/engine";
import { APP_CONFIG } from "@/lib/config/app-config";
import {
  getMyCashbackBalance,
  getMyTopupBalance,
} from "@/lib/customer/cashback";
import {
  computeServiceFeeDa,
  daUntilFreeServiceFee,
  parseTiers,
  type ServiceFeeTier,
} from "@/lib/finance/service-fee";
import {
  computeDeliveryFee,
  computeTourDeliveryFee,
  type TourBand,
} from "@/lib/delivery/pricing";
import { haversineKm } from "@/lib/delivery/distance";
import type { Json } from "@/lib/supabase/database.types";

export type CheckoutContextInput = {
  merchant_id: string;
  items: { product_id: string; quantity: number }[];
};

export type CheckoutMerchantPosition = {
  lat: number;
  lng: number;
  /** Rayon effectif (le min entre rayon commerçant et max plateforme). */
  radiusKm: number;
};

export type CheckoutDeliveryContext = {
  enabled: boolean;
  express_enabled: boolean;
  tours_enabled: boolean;
  /** Position commerçant + barème — utile au calcul live d'une position custom. */
  merchantPosition: CheckoutMerchantPosition | null;
  pricing: {
    delivery_base_da: number;
    delivery_per_km_da: number;
    delivery_free_km_threshold: number;
    delivery_min_da: number;
    delivery_max_da: number;
    delivery_max_radius_km: number;
  } | null;
  /** Adresses enregistrées du client. */
  addresses: {
    id: string;
    label: string;
    lat: number;
    lng: number;
    address_text: string | null;
    phone_override: string | null;
    is_default: boolean;
    /** Distance estimée au commerçant (km), -1 si on n'a pas pu calculer. */
    distance_km: number;
    /** Frais EXPRESS estimés (barème, DA), null si hors rayon. */
    fee_da: number | null;
    /** Frais TOURNÉE estimés (prix marchand par bande, DA), null si hors rayon. */
    tour_fee_da: number | null;
    out_of_range: boolean;
  }[];
  /** Bandes de prix tournée du commerçant (pour le calcul live d'une position custom). */
  tour_bands: TourBand[];
  /** Créneaux de tournée ouverts à venir, avec capacité restante. */
  slots: {
    id: string;
    slot_date: string;
    start_time: string;
    end_time: string;
    available: number;
  }[];
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
    max_days_ahead: number;
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
    /** Prix catalogue AVANT toute promo (= sous-total brut affiché). */
    normalTotalDa: number;
    /** Total APRÈS promos, AVANT service_fee/cashback/topup. */
    totalDa: number;
    savingsDa: number;
  };
  /** Solde cashback disponible (DA) du client connecté — 0 si non connecté. */
  cashback_balance_da: number;
  /** Solde Coligo Pay (topup, argent réel) du client connecté. */
  topup_balance_da: number;
  /**
   * Taux de cashback RÉSOLUS (surcharge marchand ?? défaut plateforme) par
   * mode de paiement — mêmes valeurs que le trigger 0118. Permet d'afficher
   * au checkout la différence de gain entre en ligne et espèces.
   */
  cashback_rate_online: number;
  cashback_rate_cash: number;
  /** Frais de service (DA) calculés serveur sur (subtotal - discount). */
  service_fee_da: number;
  /** Tiers actifs sur la plateforme — pour l'affichage du « Gratuit dès X DA ». */
  service_fee_tiers: ServiceFeeTier[];
  /** DA manquants pour atteindre la gratuité, ou null si déjà gratuit. */
  service_fee_free_in_da: number | null;
  /** Contexte livraison — `enabled=false` = section livraison cachée au checkout. */
  delivery: CheckoutDeliveryContext;
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
      "id, name, accepts_cash, accepts_online, opening_hours, min_order_da, prep_time_min, pickup_slot_minutes, max_days_ahead"
    )
    .eq("id", input.merchant_id)
    .maybeSingle();

  // Soldes du client + config plateforme + taux cashback (en parallèle).
  const [cashbackBalance, topupBalance, settings, rateOnlineRes, rateCashRes] =
    await Promise.all([
      getMyCashbackBalance(),
      getMyTopupBalance(),
      supabase
        .from("platform_settings")
        .select("service_fee_tiers")
        .eq("id", true)
        .maybeSingle(),
      supabase.rpc("resolve_rate", {
        p_merchant_id: input.merchant_id,
        p_key: "cashback_online",
      }),
      supabase.rpc("resolve_rate", {
        p_merchant_id: input.merchant_id,
        p_key: "cashback_cash",
      }),
    ]);
  const tiers = parseTiers(settings.data?.service_fee_tiers);
  const cashbackRateOnline = Number(rateOnlineRes.data ?? 0.03);
  const cashbackRateCash = Number(rateCashRes.data ?? 0);

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
      max_days_ahead: 7,
    },
    lines: [],
    cart: { subtotalDa: 0, normalTotalDa: 0, totalDa: 0, savingsDa: 0 },
    cashback_balance_da: cashbackBalance,
    topup_balance_da: topupBalance,
    cashback_rate_online: cashbackRateOnline,
    cashback_rate_cash: cashbackRateCash,
    service_fee_da: 0,
    service_fee_tiers: tiers,
    service_fee_free_in_da: null,
    delivery: {
      enabled: false,
      express_enabled: false,
      tours_enabled: false,
      merchantPosition: null,
      pricing: null,
      addresses: [] as CheckoutDeliveryContext["addresses"],
      tour_bands: [] as CheckoutDeliveryContext["tour_bands"],
      slots: [] as CheckoutDeliveryContext["slots"],
    },
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

  // Livraison : champs commerçant + barème + adresses client + créneaux.
  const [
    merchDeliveryRes,
    deliverySettingsRes,
    addressesRes,
    slotsRes,
    zonesRes,
  ] = await Promise.all([
    supabase
      .from("merchants")
      .select(
        "delivery_enabled, express_enabled, tours_enabled, delivery_radius_km, latitude, longitude"
      )
      .eq("id", merchant.id)
      .maybeSingle(),
    supabase
      .from("platform_settings")
      .select(
        "delivery_base_da, delivery_per_km_da, delivery_free_km_threshold, delivery_min_da, delivery_max_da, delivery_max_radius_km"
      )
      .eq("id", true)
      .maybeSingle(),
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { data: [] };
      const { data: customer } = await supabase
        .from("customers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!customer) return { data: [] };
      return supabase
        .from("customer_addresses")
        .select("id, label, lat, lng, address_text, phone_override, is_default")
        .eq("customer_id", customer.id)
        .order("is_default", { ascending: false });
    })(),
    supabase
      .from("delivery_slots")
      .select("id, slot_date, start_time, end_time, max_orders")
      .eq("merchant_id", merchant.id)
      .eq("status", "open")
      .gte("slot_date", new Date().toISOString().slice(0, 10))
      .order("slot_date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(30),
    supabase
      .from("merchant_delivery_zones")
      .select("band_index, max_km, price_da")
      .eq("merchant_id", merchant.id)
      .order("band_index", { ascending: true }),
  ]);

  const merchDelivery = merchDeliveryRes.data;
  const deliverySettings = deliverySettingsRes.data;
  const rawAddresses = addressesRes.data ?? [];
  const rawSlots = slotsRes.data ?? [];
  const tourBands: TourBand[] = (zonesRes.data ?? []).map((z) => ({
    band_index: z.band_index,
    max_km: Number(z.max_km),
    price_da: z.price_da,
  }));

  // Capacité restante par slot (compte commandes non-cancelled).
  const slotIds = rawSlots.map((s) => s.id);
  const usedBySlot = new Map<string, number>();
  if (slotIds.length > 0) {
    const { data: usedRows } = await supabase
      .from("orders")
      .select("delivery_slot_id")
      .in("delivery_slot_id", slotIds)
      .neq("status", "cancelled");
    for (const r of usedRows ?? []) {
      if (r.delivery_slot_id) {
        usedBySlot.set(
          r.delivery_slot_id,
          (usedBySlot.get(r.delivery_slot_id) ?? 0) + 1
        );
      }
    }
  }

  const deliveryEnabled =
    !!merchDelivery?.delivery_enabled &&
    !!deliverySettings &&
    merchDelivery.latitude != null &&
    merchDelivery.longitude != null;

  // Pour chaque adresse, on précalcule distance + frais (utile à l'UI :
  // afficher "Hors zone" sur les adresses non livrables, sans appeler le
  // serveur à chaque sélection).
  const addresses = rawAddresses.map((a) => {
    if (!deliveryEnabled || !deliverySettings || !merchDelivery) {
      return {
        id: a.id,
        label: a.label,
        lat: a.lat,
        lng: a.lng,
        address_text: a.address_text,
        phone_override: a.phone_override,
        is_default: a.is_default,
        distance_km: -1,
        fee_da: null,
        tour_fee_da: null,
        out_of_range: true,
      };
    }
    const dist = haversineKm(
      { lat: merchDelivery.latitude!, lng: merchDelivery.longitude! },
      { lat: a.lat, lng: a.lng }
    );
    const quote = computeDeliveryFee(
      dist,
      deliverySettings,
      merchDelivery.delivery_radius_km
    );
    const tourQuote = computeTourDeliveryFee(
      dist,
      tourBands,
      deliverySettings,
      merchDelivery.delivery_radius_km
    );
    return {
      id: a.id,
      label: a.label,
      lat: a.lat,
      lng: a.lng,
      address_text: a.address_text,
      phone_override: a.phone_override,
      is_default: a.is_default,
      distance_km: Number(dist.toFixed(2)),
      fee_da: quote.outOfRange ? null : quote.feeDa,
      tour_fee_da: tourQuote.outOfRange ? null : tourQuote.feeDa,
      out_of_range: quote.outOfRange,
    };
  });

  const deliveryCtx: CheckoutDeliveryContext = {
    enabled: deliveryEnabled,
    express_enabled: !!merchDelivery?.express_enabled,
    tours_enabled: !!merchDelivery?.tours_enabled,
    merchantPosition:
      deliveryEnabled && merchDelivery
        ? {
            lat: merchDelivery.latitude!,
            lng: merchDelivery.longitude!,
            radiusKm: Math.min(
              merchDelivery.delivery_radius_km ??
                deliverySettings!.delivery_max_radius_km,
              deliverySettings!.delivery_max_radius_km
            ),
          }
        : null,
    pricing: deliverySettings ?? null,
    addresses,
    tour_bands: tourBands,
    slots: rawSlots.map((s) => ({
      id: s.id,
      slot_date: s.slot_date,
      start_time: s.start_time,
      end_time: s.end_time,
      available: Math.max(0, s.max_orders - (usedBySlot.get(s.id) ?? 0)),
    })),
  };

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
      max_days_ahead: merchant.max_days_ahead ?? 7,
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
      normalTotalDa: settled.normalTotalDa,
      totalDa: settled.totalDa,
      savingsDa: settled.savingsDa,
    },
    cashback_balance_da: cashbackBalance,
    topup_balance_da: topupBalance,
    cashback_rate_online: cashbackRateOnline,
    cashback_rate_cash: cashbackRateCash,
    service_fee_da: computeServiceFeeDa(settled.totalDa, tiers),
    service_fee_tiers: tiers,
    service_fee_free_in_da: daUntilFreeServiceFee(settled.totalDa, tiers),
    delivery: deliveryCtx,
  };
}
