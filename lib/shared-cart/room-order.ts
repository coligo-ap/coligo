import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadLineOptions } from "@/lib/checkout/option-pricing";
import { computeCart, type EnginePromotion } from "@/lib/promotions/engine";
import { computeServiceFeeDa, parseTiers } from "@/lib/finance/service-fee";
import {
  CHARGILY_MIN_AMOUNT_DA,
  resolveMinOrderDa,
} from "@/lib/config/payment-limits";
import { APP_CONFIG } from "@/lib/config/app-config";
import { getFeatureFlags } from "@/lib/data/feature-flags";

// =============================================================================
// createRoomOrder — « LE PREMIER QUI PAIE, PAIE » (panier partagé).
//
// Un membre du groupe tape « Payer » alors que le capitaine n'a pas encore
// commandé : on crée NOUS-MÊMES la commande (compte du capitaine, RETRAIT
// asap, paiement EN LIGNE) puis on renvoie le lien /payer/{ptoken}.
//
// ⚠️ ARGENT : ce chemin REFLÈTE createOrder (checkout/actions.ts) pour le cas
// pickup + online + sans wallet + sans code : produits & options revalidés DB,
// promotions via computeCart (LE moteur), frais de service sur le NET
// (parseTiers + computeServiceFeeDa), snapshots gross/net, mêmes colonnes
// d'insert, mêmes lignes/options. Aucun montant ne vient du client.
//
// CONCURRENCE (deux « Payer » simultanés) : on crée la commande PUIS on la
// lie au panier par un UPDATE conditionnel (order_id IS NULL). Le perdant
// SUPPRIME sa commande orpheline (pending, impayée) et repart avec le lien
// du gagnant — une seule commande peut exister par panier.
// =============================================================================

export type RoomOrderResult =
  | { ok: true; ptoken: string }
  | { ok: false; reason: string; message: string };

function fail(reason: string, message: string): RoomOrderResult {
  return { ok: false, reason, message };
}

export async function createRoomOrder(
  shareToken: string
): Promise<RoomOrderResult> {
  const admin = createAdminClient();
  const from = admin.from.bind(admin) as unknown as (t: string) => {
    select: (c: string) => {
      eq: (
        col: string,
        v: string
      ) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
      };
    };
    update: (v: Record<string, unknown>) => {
      eq: (
        col: string,
        v2: string
      ) => {
        is: (
          col2: string,
          v3: null
        ) => {
          select: (c: string) => {
            maybeSingle: () => Promise<{
              data: Record<string, unknown> | null;
            }>;
          };
        };
      };
    };
  };

  // ── 1. Panier + gates ──────────────────────────────────────────────────────
  const { data: cart } = await from("shared_carts")
    .select(
      "id, share_token, status, order_id, payment_token, expires_at, merchant_id, captain_customer_id"
    )
    .eq("share_token", shareToken)
    .maybeSingle();
  if (!cart) return fail("not_found", "Panier introuvable.");
  if (cart.order_id) {
    // Déjà commandé (autre onglet / capitaine) → renvoyer le lien existant.
    return reuseExistingOrder(cart);
  }
  if (
    (cart.status !== "open" && cart.status !== "locked") ||
    new Date(cart.expires_at as string) < new Date()
  ) {
    return fail("closed", "Ce panier n'est plus actif.");
  }

  const flags = await getFeatureFlags();
  if (flags.online_payment.status !== "active") {
    return fail("online_off", "Le paiement en ligne est indisponible.");
  }
  if (flags.shared_cart.status !== "active") {
    return fail("disabled", "Le panier partagé est indisponible.");
  }

  const { data: merchant } = await admin
    .from("merchants")
    .select(
      "id, name, is_active, is_frozen, accepts_online, orders_paused, prep_time_min, min_order_da"
    )
    .eq("id", cart.merchant_id as string)
    .maybeSingle();
  if (!merchant || !merchant.is_active || merchant.is_frozen) {
    return fail("merchant_off", "Ce commerçant n'est pas disponible.");
  }
  if (!merchant.accepts_online) {
    return fail(
      "no_online",
      "Ce commerçant n'accepte pas le paiement en ligne."
    );
  }
  if (merchant.orders_paused) {
    return fail("paused", "Ce commerçant a suspendu les commandes.");
  }

  const { data: captain } = await admin
    .from("customers")
    .select("id, full_name, phone")
    .eq("id", cart.captain_customer_id as string)
    .maybeSingle();
  if (!captain) return fail("not_found", "Capitaine introuvable.");

  // ── 2. Lignes du panier partagé → items façon checkout ────────────────────
  const itemsFrom = admin.from.bind(admin) as unknown as (t: string) => {
    select: (c: string) => {
      eq: (
        col: string,
        v: string
      ) => Promise<{
        data:
          | { product_id: string; option_ids: string[]; quantity: number }[]
          | null;
      }>;
    };
  };
  const { data: scItems } = await itemsFrom("shared_cart_items")
    .select("product_id, option_ids, quantity")
    .eq("cart_id", cart.id as string);
  if (!scItems || scItems.length === 0) {
    return fail("empty", "Le panier est vide.");
  }
  const inputItems = scItems.map((i) => ({
    product_id: i.product_id,
    quantity: Number(i.quantity),
    options: (i.option_ids ?? []).map((option_id) => ({ option_id })),
  }));

  // Produits revalidés DB (mêmes colonnes que createOrder).
  const productIds = [...new Set(inputItems.map((i) => i.product_id))];
  const { data: products } = await admin
    .from("products")
    .select(
      "id, merchant_id, name_fr, name_ar, unit, price_da, is_available, stock_qty, min_qty, max_qty"
    )
    .in("id", productIds);
  const avail = (products ?? []).filter(
    (p) => p.is_available && p.merchant_id === cart.merchant_id
  );
  const availIds = new Set(avail.map((p) => p.id));
  const usable = inputItems.filter((i) => availIds.has(i.product_id));
  if (usable.length === 0) {
    return fail("empty", "Aucun article encore disponible.");
  }

  // Options revalidées + deltas (helper PARTAGÉ avec le checkout).
  const { perLine: lineOptions, deltaPerLine } = await loadLineOptions(
    admin,
    usable
  );

  // ── 3. Promotions via LE moteur (mêmes prix que le checkout) ──────────────
  const { data: promosRaw } = await admin
    .from("promotions")
    .select(
      `id, merchant_id, type, status, title_fr, title_ar, discount_kind,
       discount_value, code, buy_qty, get_qty, min_subtotal_da, starts_at,
       ends_at, max_uses, max_uses_per_customer, uses_count, financeur,
       promotion_products ( product_id )`
    )
    .eq("merchant_id", cart.merchant_id as string)
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
      min_subtotal_da: number | null;
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
    minSubtotalDa: p.min_subtotal_da,
    productIds: (p.promotion_products ?? []).map((x) => x.product_id),
    startsAt: p.starts_at,
    endsAt: p.ends_at,
  }));

  const lines = usable.map((it, idx) => {
    const p = avail.find((pp) => pp.id === it.product_id)!;
    return {
      productId: it.product_id,
      quantity: it.quantity,
      unitPriceDa: p.price_da + deltaPerLine[idx],
    };
  });
  const settled = computeCart(lines, promotions, {
    minPriceDa: APP_CONFIG.promotions.minPriceDa,
    commissionRate: APP_CONFIG.commission.rate,
    promoCode: null,
  });

  // Snapshots identiques au checkout (pas de code, pas de wallet).
  const clientGoodsDa = settled.totalDa;
  const grossTotalDa = settled.normalTotalDa;
  const netTotalDa = settled.totalDa;

  const minOrder = resolveMinOrderDa("online", merchant.min_order_da);
  if (settled.totalDa < minOrder) {
    return fail("min_order", `Le minimum de commande est de ${minOrder} DA.`);
  }

  // ── 4. Frais de service + estimation cashback (mêmes règles) ──────────────
  const { data: settingsRow } = await admin
    .from("platform_settings")
    .select("service_fee_tiers, cashback_online, cashback_cash")
    .eq("id", true)
    .maybeSingle();
  const serviceFeeTiers = parseTiers(settingsRow?.service_fee_tiers);
  const serviceFeeDa = computeServiceFeeDa(clientGoodsDa, serviceFeeTiers);
  const cashbackEstimate = Math.round(
    settled.totalDa * Number(settingsRow?.cashback_online ?? 0.03)
  );
  const totalDa = clientGoodsDa + serviceFeeDa;
  if (totalDa < CHARGILY_MIN_AMOUNT_DA) {
    return fail(
      "chargily_min",
      `Le paiement en ligne nécessite un minimum de ${CHARGILY_MIN_AMOUNT_DA} DA.`
    );
  }

  // ── 5. INSERT commande (mêmes colonnes que createOrder, variante retrait) ──
  const clientOperationId = randomUUID();
  const pickupAt = new Date(
    Date.now() + (merchant.prep_time_min ?? 15) * 60_000
  );
  const { data: order, error: orderErr } = await (
    admin.from("orders") as unknown as {
      insert: (v: Record<string, unknown>) => {
        select: (c: string) => {
          single: () => Promise<{
            data: { id: string; pickup_code: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
    }
  )
    .insert({
      merchant_id: merchant.id,
      customer_id: captain.id,
      customer_name: captain.full_name,
      customer_phone: captain.phone,
      status: "pending",
      payment_method: "online",
      payment_status: "pending",
      pickup_type: "asap",
      pickup_slot_at: pickupAt.toISOString(),
      pickup_slot_start: null,
      pickup_slot_end: null,
      customer_note: null,
      client_operation_id: clientOperationId,
      subtotal_da: settled.subtotalDa,
      discount_da: 0,
      gross_total_da: grossTotalDa,
      net_total_da: netTotalDa,
      promo_id: null,
      promo_code: null,
      promo_financeur: null,
      platform_promo_id: null,
      platform_promo_code: null,
      platform_discount_da: 0,
      total_da: totalDa,
      cashback_used_da: 0,
      topup_used_da: 0,
      service_fee_da: serviceFeeDa,
      cashback_da: 0,
      cashback_estimate_da: cashbackEstimate,
      commission_da: 0,
      fulfillment_type: "pickup",
      delivery_mode: null,
      delivery_fee_da: 0,
    })
    .select("id, pickup_code")
    .single();
  if (orderErr || !order) {
    // Mêmes mappings que createOrder : les triggers DB (gates par client,
    // kill-switch…) tournent aussi pour service_role — on explique la vraie
    // cause au lieu d'un « réessaye » mensonger, et on trace l'erreur brute.
    console.error("[room-order] insert orders:", orderErr?.message);
    if (orderErr?.message?.includes("feature_disabled:online_payment")) {
      // Coupure PAR CLIENT (mig 0397) sur le compte du capitaine : la commande
      // de groupe porte sur SON compte. On le dit explicitement — le capitaine
      // peut toujours commander lui-même en payant au retrait.
      return fail(
        "online_cut",
        "Le paiement en ligne est désactivé sur le compte du capitaine. Il peut quand même commander en payant au retrait."
      );
    }
    if (orderErr?.message?.includes("account_blocked")) {
      return fail(
        "blocked",
        "Le compte du capitaine est suspendu : commande impossible. Contactez le support Coligo."
      );
    }
    return fail("error", "Création de la commande impossible. Réessaye.");
  }

  // Lignes + options — snapshots identiques au checkout.
  const itemsRows = settled.lines.map((l) => {
    const product = avail.find((p) => p.id === l.productId)!;
    return {
      order_id: order.id,
      product_name: product.name_fr,
      name_ar: product.name_ar,
      unit: product.unit,
      unit_price_da: l.appliedUnitPriceDa,
      quantity: l.quantity,
      line_total_da: l.lineTotalDa,
    };
  });
  const { data: insertedItems, error: itemsErr } = await admin
    .from("order_items")
    .insert(itemsRows)
    .select("id");
  if (itemsErr || !insertedItems) {
    console.error("[room-order] insert order_items:", itemsErr?.message);
    await admin.from("orders").delete().eq("id", order.id);
    return fail("error", "Erreur d'ajout des articles. Réessaye.");
  }
  const optionRows = insertedItems.flatMap((row, idx) =>
    (lineOptions[idx] ?? []).map((o, pos) => ({
      order_item_id: row.id,
      group_name_fr: o.group_name_fr,
      group_name_ar: o.group_name_ar,
      option_name_fr: o.option_name_fr,
      option_name_ar: o.option_name_ar,
      price_delta_da: o.price_delta_da,
      position: pos,
    }))
  );
  if (optionRows.length > 0) {
    await admin.from("order_item_options").insert(optionRows);
  }

  // ── 6. Liaison au panier — UN SEUL gagnant (order_id IS NULL) ─────────────
  const ptoken = randomUUID().replace(/-/g, "").slice(0, 16);
  const { data: attached } = await from("shared_carts")
    .update({
      status: "ordered",
      order_id: order.id,
      payment_token: ptoken,
      payment_token_created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", cart.id as string)
    .is("order_id", null)
    .select("id")
    .maybeSingle();

  if (!attached) {
    // Course perdue : un autre payeur (ou le capitaine) a déjà lié SA
    // commande — on supprime la nôtre (pending, impayée) et on suit la sienne.
    await admin.from("orders").delete().eq("id", order.id);
    const { data: again } = await from("shared_carts")
      .select(
        "id, share_token, status, order_id, payment_token, expires_at, merchant_id, captain_customer_id"
      )
      .eq("id", cart.id as string)
      .maybeSingle();
    if (again?.order_id) return reuseExistingOrder(again);
    return fail("error", "Réessaye — le panier vient de changer.");
  }

  return { ok: true, ptoken };
}

/** Le panier a déjà SA commande : renvoyer le lien de paiement (get-or-create). */
async function reuseExistingOrder(
  cart: Record<string, unknown>
): Promise<RoomOrderResult> {
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("payment_method, payment_status, status")
    .eq("id", cart.order_id as string)
    .maybeSingle();
  if (!order || order.payment_method !== "online") {
    return fail("cash_order", "Cette commande se règle en espèces au retrait.");
  }
  if (order.payment_status === "paid" || order.payment_status === "refunded") {
    return fail("already_paid", "La commande est déjà payée.");
  }
  if (order.status === "cancelled") {
    return fail("cancelled", "La commande a été annulée.");
  }
  if (cart.payment_token) {
    return { ok: true, ptoken: cart.payment_token as string };
  }
  const ptoken = randomUUID().replace(/-/g, "").slice(0, 16);
  const from = admin.from.bind(admin) as unknown as (t: string) => {
    update: (v: Record<string, unknown>) => {
      eq: (
        col: string,
        v2: string
      ) => {
        is: (
          col2: string,
          v3: null
        ) => {
          select: (c: string) => {
            maybeSingle: () => Promise<{
              data: Record<string, unknown> | null;
            }>;
          };
        };
      };
    };
    select: (c: string) => {
      eq: (
        col: string,
        v: string
      ) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
      };
    };
  };
  const { data: set } = await from("shared_carts")
    .update({
      payment_token: ptoken,
      payment_token_created_at: new Date().toISOString(),
    })
    .eq("id", cart.id as string)
    .is("payment_token", null)
    .select("id")
    .maybeSingle();
  if (set) return { ok: true, ptoken };
  const { data: again } = await from("shared_carts")
    .select("payment_token")
    .eq("id", cart.id as string)
    .maybeSingle();
  if (again?.payment_token) {
    return { ok: true, ptoken: again.payment_token as string };
  }
  return fail("error", "Réessaye.");
}
