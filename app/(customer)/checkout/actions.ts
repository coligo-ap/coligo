"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { computeCart, type EnginePromotion } from "@/lib/promotions/engine";
import { isOpenNow, normalizeOpeningHours } from "@/lib/merchant/opening-hours";
import { APP_CONFIG } from "@/lib/config/app-config";
import {
  getCashbackBalanceForCustomer,
  getTopupBalanceForCustomer,
} from "@/lib/customer/cashback";
import {
  createCheckout as createChargilyCheckout,
  buildCallbackUrls,
} from "@/lib/payments/chargily";
import type { OpeningHours, PaymentMethod } from "@/lib/types";

export type CreateOrderInput = {
  merchant_id: string;
  client_operation_id: string;
  items: { product_id: string; quantity: number }[];
  pickup_type: "asap" | "slot";
  pickup_slot_start?: string | null; // ISO
  pickup_slot_end?: string | null; // ISO
  payment_method: PaymentMethod;
  customer_note?: string | null;
  promo_code?: string | null;
  /**
   * Montant de cashback à utiliser (en DA). Plafonné côté serveur au solde
   * ET au total après promos. Si null/undefined/0 → aucun cashback dépensé.
   */
  cashback_to_use_da?: number | null;
  /**
   * Montant de Coligo Pay (topup) à utiliser (en DA). Plafonné côté serveur
   * au solde topup ET au total restant après cashback. Si null/undefined/0
   * → aucun topup dépensé.
   */
  topup_to_use_da?: number | null;
};

export type CreateOrderResult =
  | {
      ok: true;
      order_id: string;
      pickup_code: string;
      /**
       * URL Chargily si payment_method=online ET total > 0. Le client doit y
       * être redirigé. Pour payment_method=cash ou total=0 (cashback couvre
       * tout), absent.
       */
      checkout_url?: string;
    }
  | { ok: false; error: string };

export async function createOrder(
  input: CreateOrderInput
): Promise<CreateOrderResult> {
  const supabase = await createClient();

  // ---------------------------------------------------------------------------
  // 1. Auth — un client connecté est REQUIS au checkout (PARTIE A).
  // ---------------------------------------------------------------------------
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return { ok: false, error: "Tu dois te connecter pour commander." };

  const { data: customer } = await supabase
    .from("customers")
    .select("id, full_name, phone")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!customer) {
    return {
      ok: false,
      error: "Profil client introuvable. Recrée ton compte client.",
    };
  }

  // ---------------------------------------------------------------------------
  // 2. Idempotency — si on a déjà créé cette commande, on renvoie l'existante.
  //
  // Cas particulier paiement en ligne :
  //   - si la commande existe ET est `online` ET `payment_status = pending`
  //     (paiement abandonné ou échoué) → on REGÉNÈRE un checkout Chargily
  //     plutôt que de laisser le client sans URL. Le `payment_status` côté
  //     trigger ne fire qu'à la transition vers 'paid', donc aucun risque
  //     de double-encaissement.
  //   - une commande déjà payée (`payment_status = paid`) → retour simple.
  // ---------------------------------------------------------------------------
  const { data: existing } = await supabase
    .from("orders")
    .select(
      "id, pickup_code, payment_method, payment_status, total_da, customer_id"
    )
    .eq("client_operation_id", input.client_operation_id)
    .maybeSingle();
  if (existing) {
    let checkoutUrl: string | undefined;
    if (
      existing.payment_method === "online" &&
      existing.payment_status === "pending" &&
      existing.total_da > 0
    ) {
      try {
        const { successUrl, failureUrl, webhookEndpoint } = buildCallbackUrls({
          context: "order",
          orderId: existing.id,
        });
        const checkout = await createChargilyCheckout({
          amount: existing.total_da,
          successUrl,
          failureUrl,
          webhookEndpoint,
          locale: "fr",
          description: `Commande Coligo #${existing.pickup_code}`,
          metadata: {
            type: "order",
            order_id: existing.id,
            client_operation_id: input.client_operation_id,
            customer_id: existing.customer_id ?? null,
          },
        });
        checkoutUrl = checkout.checkout_url;
      } catch (e) {
        return {
          ok: false,
          error:
            e instanceof Error
              ? `Impossible d'initier le paiement : ${e.message}`
              : "Impossible d'initier le paiement.",
        };
      }
    }
    return {
      ok: true,
      order_id: existing.id,
      pickup_code: existing.pickup_code,
      checkout_url: checkoutUrl,
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Charge la fiche commerçant (vue publique → vérifie qu'il est actif).
  // ---------------------------------------------------------------------------
  const { data: merchant } = await supabase
    .from("merchants_public")
    .select(
      "id, name, accepts_cash, accepts_online, opening_hours, min_order_da, prep_time_min, max_orders_per_slot, is_active"
    )
    .eq("id", input.merchant_id)
    .maybeSingle();
  if (!merchant || !merchant.is_active) {
    return { ok: false, error: "Ce commerce n'est plus disponible." };
  }

  // Validation horaire : le commerce doit être ouvert MAINTENANT (cash) ou
  // accepter au moins le mode demandé. (Pour "slot" on vérifie aussi que
  // l'heure choisie tombe dans les horaires).
  const opening: OpeningHours = normalizeOpeningHours(
    merchant.opening_hours as Partial<OpeningHours> | null
  );
  if (!isOpenNow(opening)) {
    return {
      ok: false,
      error:
        "Le commerce est fermé pour le moment. Reviens à ses prochaines heures d'ouverture.",
    };
  }

  // Validation mode de paiement accepté.
  if (input.payment_method === "cash" && !merchant.accepts_cash) {
    return {
      ok: false,
      error: "Ce commerce n'accepte pas le paiement en espèces.",
    };
  }
  if (input.payment_method === "online" && !merchant.accepts_online) {
    return {
      ok: false,
      error: "Ce commerce n'accepte pas le paiement en ligne.",
    };
  }

  // ---------------------------------------------------------------------------
  // 4. Recharge les produits côté serveur (ne JAMAIS faire confiance au client).
  // ---------------------------------------------------------------------------
  const productIds = input.items.map((i) => i.product_id);
  if (productIds.length === 0) {
    return { ok: false, error: "Le panier est vide." };
  }
  const { data: products } = await supabase
    .from("products")
    .select("id, merchant_id, name_fr, price_da, is_available, stock_qty")
    .in("id", productIds);

  if (!products || products.length !== productIds.length) {
    return { ok: false, error: "Certains produits ne sont plus disponibles." };
  }
  for (const p of products) {
    if (p.merchant_id !== merchant.id) {
      return {
        ok: false,
        error: "Le panier contient des produits d'un autre commerce.",
      };
    }
    if (!p.is_available) {
      return {
        ok: false,
        error: `Le produit « ${p.name_fr} » n'est plus disponible.`,
      };
    }
    const qty = input.items.find((i) => i.product_id === p.id)?.quantity ?? 0;
    if (p.stock_qty != null && qty > p.stock_qty) {
      return {
        ok: false,
        error: `Stock insuffisant pour « ${p.name_fr} » (max ${p.stock_qty}).`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Charge les promos actives + calcul via le MOTEUR (source de vérité).
  // ---------------------------------------------------------------------------
  const { data: promosRaw } = await supabase
    .from("promotions")
    .select(
      `id, merchant_id, type, status, discount_kind, discount_value, code,
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

  const lines = input.items.map((it) => {
    const p = products.find((pp) => pp.id === it.product_id)!;
    return {
      productId: it.product_id,
      quantity: it.quantity,
      unitPriceDa: p.price_da,
    };
  });

  const settled = computeCart(lines, promotions, {
    minPriceDa: APP_CONFIG.promotions.minPriceDa,
    commissionRate: APP_CONFIG.commission.rate,
    promoCode: input.promo_code ?? null,
  });

  // Minimum de commande (sur le total APRÈS promos).
  if (merchant.min_order_da > 0 && settled.totalDa < merchant.min_order_da) {
    return {
      ok: false,
      error: `Le minimum de commande est de ${merchant.min_order_da} DA.`,
    };
  }

  // Validation créneau si pickup_type=slot.
  if (input.pickup_type === "slot") {
    if (!input.pickup_slot_start || !input.pickup_slot_end) {
      return { ok: false, error: "Choisis un créneau de retrait." };
    }
    const start = new Date(input.pickup_slot_start);
    if (start.getTime() < Date.now() - 60_000) {
      return { ok: false, error: "Ce créneau est passé." };
    }
    // Capacité par créneau si définie.
    if (merchant.max_orders_per_slot != null) {
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("merchant_id", merchant.id)
        .eq("pickup_slot_start", input.pickup_slot_start);
      if ((count ?? 0) >= merchant.max_orders_per_slot) {
        return {
          ok: false,
          error: "Ce créneau est complet, choisis-en un autre.",
        };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Création de la commande + lignes — snapshots immuables.
  // ---------------------------------------------------------------------------
  // pickup_slot_at : on stocke aussi le timestamp principal (compat avec la
  // logique existante). Pour ASAP : maintenant + prep_time_min.
  const pickupAt =
    input.pickup_type === "slot" && input.pickup_slot_start
      ? new Date(input.pickup_slot_start)
      : new Date(Date.now() + merchant.prep_time_min * 60_000);

  const cashbackEstimate = Math.round(
    settled.totalDa * (input.payment_method === "online" ? 0.03 : 0) // estimation MVP
  );

  // ---------------------------------------------------------------------------
  // 5b. Cashback DÉPENSÉ par le client — recalcul serveur (PARTIE A) :
  //   - jamais > solde du client
  //   - jamais > total après promos
  //   - figé dans la commande (snapshot)
  // Le trigger SQL `spend_customer_cashback_on_order_create` génère l'écriture
  // négative dans le ledger client à l'INSERT de la commande.
  // ---------------------------------------------------------------------------
  let cashbackUsed = 0;
  if ((input.cashback_to_use_da ?? 0) > 0) {
    const balance = await getCashbackBalanceForCustomer(customer.id);
    const requested = Math.max(0, Math.floor(input.cashback_to_use_da ?? 0));
    cashbackUsed = Math.min(requested, balance, settled.totalDa);
  }
  const totalAfterCashback = Math.max(0, settled.totalDa - cashbackUsed);

  // -------------------------------------------------------------------------
  // 5c. Coligo Pay (topup) DÉPENSÉ — recalcul serveur :
  //   - jamais > solde topup du client
  //   - jamais > total restant après cashback
  //   - figé dans la commande (snapshot)
  // Le trigger SQL `spend_customer_topup_on_order_create` génère l'écriture
  // négative dans le ledger client à l'INSERT de la commande.
  // -------------------------------------------------------------------------
  let topupUsed = 0;
  if ((input.topup_to_use_da ?? 0) > 0) {
    const topupBalance = await getTopupBalanceForCustomer(customer.id);
    const requested = Math.max(0, Math.floor(input.topup_to_use_da ?? 0));
    topupUsed = Math.min(requested, topupBalance, totalAfterCashback);
  }
  const totalAfterWallets = Math.max(0, totalAfterCashback - topupUsed);

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({
      merchant_id: merchant.id,
      customer_id: customer.id,
      customer_name: customer.full_name,
      customer_phone: customer.phone,
      status: "pending",
      payment_method: input.payment_method,
      payment_status: input.payment_method === "online" ? "pending" : "pending",
      pickup_type: input.pickup_type,
      pickup_slot_at: pickupAt.toISOString(),
      pickup_slot_start: input.pickup_slot_start ?? null,
      pickup_slot_end: input.pickup_slot_end ?? null,
      customer_note: input.customer_note ?? null,
      client_operation_id: input.client_operation_id,
      subtotal_da: settled.subtotalDa,
      discount_da:
        Math.max(0, settled.normalTotalDa - settled.subtotalDa) +
        (settled.promoCode?.discountDa ?? 0),
      total_da: totalAfterWallets,
      cashback_used_da: cashbackUsed,
      topup_used_da: topupUsed,
      service_fee_da: 0,
      cashback_da: 0,
      cashback_estimate_da: cashbackEstimate,
      commission_da: 0, // figé à la complétion par le trigger wallet
    })
    .select("id, pickup_code")
    .single();

  if (orderErr || !order) {
    if (orderErr?.code === "23505") {
      // Duplicate via client_operation_id : race condition, on relit.
      const { data: dup } = await supabase
        .from("orders")
        .select("id, pickup_code")
        .eq("client_operation_id", input.client_operation_id)
        .maybeSingle();
      if (dup)
        return { ok: true, order_id: dup.id, pickup_code: dup.pickup_code };
    }
    return {
      ok: false,
      error: orderErr?.message ?? "Erreur à la création de la commande.",
    };
  }

  // Lignes (snapshot prix unitaire + ligne).
  const itemsRows = settled.lines.map((l) => {
    const product = products.find((p) => p.id === l.productId)!;
    return {
      order_id: order.id,
      product_name: product.name_fr,
      unit_price_da: l.appliedUnitPriceDa,
      quantity: l.quantity,
      line_total_da: l.lineTotalDa,
    };
  });
  const { error: itemsErr } = await supabase
    .from("order_items")
    .insert(itemsRows);
  if (itemsErr) {
    // Compensation : si les items échouent, on annule la commande.
    await supabase.from("orders").delete().eq("id", order.id);
    return { ok: false, error: `Erreur ajout articles : ${itemsErr.message}` };
  }

  // ---------------------------------------------------------------------------
  // 7. Paiement en ligne — création du checkout Chargily.
  //
  // Cas exotique mais possible : online + totalAfterCashback === 0 (le cashback
  // couvre tout). Dans ce cas, AUCUN paiement n'est nécessaire ; on bascule la
  // commande directement à `payment_status = paid` côté serveur (le trigger
  // wallet fera ses écritures normalement). Pas de Chargily à appeler.
  // ---------------------------------------------------------------------------
  let checkoutUrl: string | undefined;
  if (input.payment_method === "online") {
    if (totalAfterWallets === 0) {
      await supabase
        .from("orders")
        .update({ payment_status: "paid" })
        .eq("id", order.id);
    } else {
      try {
        const { successUrl, failureUrl, webhookEndpoint } = buildCallbackUrls({
          context: "order",
          orderId: order.id,
        });
        const checkout = await createChargilyCheckout({
          amount: totalAfterWallets,
          successUrl,
          failureUrl,
          webhookEndpoint,
          locale: "fr",
          description: `Commande Coligo #${order.pickup_code}`,
          metadata: {
            type: "order",
            order_id: order.id,
            client_operation_id: input.client_operation_id,
            customer_id: customer.id,
          },
        });
        checkoutUrl = checkout.checkout_url;
      } catch (e) {
        // On NE supprime PAS la commande : le client peut réessayer (idempotent
        // via client_operation_id) et reprendra son checkout à la prochaine
        // soumission.
        return {
          ok: false,
          error:
            e instanceof Error
              ? `Commande créée mais paiement indisponible : ${e.message}`
              : "Commande créée mais paiement indisponible.",
        };
      }
    }
  }

  revalidatePath("/commandes");
  return {
    ok: true,
    order_id: order.id,
    pickup_code: order.pickup_code,
    checkout_url: checkoutUrl,
  };
}

// ===========================================================================
// retryOnlineOrderPayment — réessayer un paiement abandonné/échoué.
// L'utilisateur clique « Réessayer » sur /checkout/failure ou /commandes/[id].
// Pré-requis : la commande lui appartient, elle est `online`, `payment_status`
// est encore 'pending' ou 'failed', et `total_da > 0`.
// ===========================================================================
export async function retryOnlineOrderPayment(
  orderId: string
): Promise<{ ok: true; checkout_url: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu dois te reconnecter." };

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!customer) return { ok: false, error: "Profil client introuvable." };

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, pickup_code, payment_method, payment_status, total_da, customer_id, client_operation_id"
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: "Commande introuvable." };
  if (order.customer_id !== customer.id) {
    return { ok: false, error: "Cette commande ne t'appartient pas." };
  }
  if (order.payment_method !== "online") {
    return {
      ok: false,
      error: "Cette commande n'est pas un paiement en ligne.",
    };
  }
  if (order.payment_status === "paid") {
    return { ok: false, error: "Cette commande est déjà payée." };
  }
  if (order.payment_status === "refunded") {
    return { ok: false, error: "Cette commande a été remboursée." };
  }
  if (order.total_da <= 0) {
    return { ok: false, error: "Montant invalide." };
  }

  try {
    const { successUrl, failureUrl, webhookEndpoint } = buildCallbackUrls({
      context: "order",
      orderId: order.id,
    });
    const checkout = await createChargilyCheckout({
      amount: order.total_da,
      successUrl,
      failureUrl,
      webhookEndpoint,
      locale: "fr",
      description: `Commande Coligo #${order.pickup_code}`,
      metadata: {
        type: "order",
        order_id: order.id,
        client_operation_id: order.client_operation_id ?? null,
        customer_id: customer.id,
      },
    });
    // Si la commande était passée à 'failed' on la repasse 'pending' pour
    // refléter la nouvelle tentative.
    if (order.payment_status === "failed") {
      await supabase
        .from("orders")
        .update({ payment_status: "pending" })
        .eq("id", order.id);
    }
    return { ok: true, checkout_url: checkout.checkout_url };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? `Paiement indisponible : ${e.message}`
          : "Paiement indisponible.",
    };
  }
}
