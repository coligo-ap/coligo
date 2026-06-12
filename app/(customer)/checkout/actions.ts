"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { computeCart, type EnginePromotion } from "@/lib/promotions/engine";
import { isOpenNow, normalizeOpeningHours } from "@/lib/merchant/opening-hours";
import {
  computePauseState,
  pauseReasonMessage,
} from "@/lib/merchant/pause-state";
import { APP_CONFIG } from "@/lib/config/app-config";
import { isValidContactPhone } from "@/lib/dz/phone";
import {
  getCashbackBalanceForCustomer,
  getTopupBalanceForCustomer,
} from "@/lib/customer/cashback";
import {
  createCheckout as createChargilyCheckout,
  buildCallbackUrls,
} from "@/lib/payments/chargily";
import {
  CHARGILY_MIN_AMOUNT_DA,
  resolveMinOrderDa,
} from "@/lib/config/payment-limits";
import { computeServiceFeeDa, parseTiers } from "@/lib/finance/service-fee";
import { notifyMerchantNewOrder } from "@/lib/fcm/triggers";
import {
  computeDeliveryFee,
  computeTourDeliveryFee,
} from "@/lib/delivery/pricing";
import { haversineKm } from "@/lib/delivery/distance";
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
  /**
   * Livraison (optionnelle — défaut : retrait sur place).
   * Le serveur recalcule le prix avec `computeDeliveryFee` ; on ne fait pas
   * confiance au client. L'adresse est snapshotée dans la commande.
   */
  fulfillment_type?: "pickup" | "delivery";
  delivery_mode?: "express" | "tour" | null;
  delivery_address_id?: string | null;
  delivery_slot_id?: string | null;
  delivery_phone_override?: string | null;
  /** Nom du destinataire si on livre à quelqu'un d'autre. */
  delivery_recipient_name?: string | null;
  /**
   * Position custom posée à la volée sur la carte (alternative à
   * `delivery_address_id`). Si fournie, ON L'UTILISE comme source de
   * vérité ; sinon on regarde l'adresse enregistrée. Au moins UNE des deux
   * est requise si fulfillment_type=delivery.
   */
  delivery_custom_lat?: number | null;
  delivery_custom_lng?: number | null;
  /** Adresse lisible (reverse-geocode) du point custom — pour le livreur. */
  delivery_custom_address_text?: string | null;
  /** Note du client → livreur/commerçant (max 300 chars). */
  delivery_note?: string | null;
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

  // cod_blocked / noshow_pending (mig 0116) pas encore dans database.types.ts
  // généré (Docker requis pour gen types) → cast localisé du retour.
  const { data: customer } = (await supabase
    .from("customers")
    .select("id, full_name, phone, cod_blocked, noshow_pending")
    .eq("user_id", user.id)
    .maybeSingle()) as {
    data: {
      id: string;
      full_name: string | null;
      phone: string | null;
      cod_blocked: boolean | null;
      noshow_pending: boolean | null;
    } | null;
  };
  if (!customer) {
    return {
      ok: false,
      error: "Profil client introuvable. Recrée ton compte client.",
    };
  }
  // Téléphone VALIDE obligatoire pour commander (commande NOT NULL + contact
  // livraison). Cas des comptes créés via connexion sociale (Google) sans numéro
  // OU avec un numéro non conforme.
  if (!isValidContactPhone(customer.phone)) {
    return {
      ok: false,
      error:
        "Ajoute un numéro de téléphone algérien valide (0X XX XX XX XX) dans ton profil (Compte) avant de commander.",
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
      "id, status, pickup_code, payment_method, payment_status, total_da, customer_id"
    )
    .eq("client_operation_id", input.client_operation_id)
    .maybeSingle();
  if (existing) {
    // Si cette commande a été annulée définitivement (webhook checkout.failed
    // → status='cancelled'), on refuse — le client doit recommencer avec un
    // nouveau client_operation_id (frais à chaque clic du bouton Confirmer
    // côté UI). Évite de retourner une commande zombie.
    if (existing.status === "cancelled") {
      return {
        ok: false,
        error:
          "La précédente tentative a été annulée. Recharge la page et reconfirme depuis ton panier.",
      };
    }
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
      "id, name, accepts_cash, accepts_online, opening_hours, min_order_da, prep_time_min, max_orders_per_slot, max_days_ahead, is_active, orders_paused, paused_until, closure_start, closure_end"
    )
    .eq("id", input.merchant_id)
    .maybeSingle();
  if (!merchant || !merchant.is_active) {
    return { ok: false, error: "Ce commerce n'est plus disponible." };
  }
  // Pause / fermeture commerçant. Une commande IMMÉDIATE (asap) est refusée si
  // le commerce est fermé maintenant. Une commande PROGRAMMÉE (créneau futur)
  // reste possible — le client commande pour plus tard — sauf si le créneau
  // tombe dans une fermeture programmée (vérifié dans la validation créneau).
  const pauseState = computePauseState({
    orders_paused: merchant.orders_paused,
    paused_until: merchant.paused_until,
    closure_start: merchant.closure_start,
    closure_end: merchant.closure_end,
  });
  if (input.pickup_type === "asap" && pauseState.closedNow) {
    return {
      ok: false,
      error:
        pauseReasonMessage(pauseState) ||
        "Ce commerce ne prend pas de commandes pour l'instant.",
    };
  }

  // Validation horaire :
  //   - pickup_type='asap' → le commerce doit être ouvert MAINTENANT (récup
  //     immédiate après préparation).
  //   - pickup_type='slot' → on autorise la commande même si le commerçant
  //     est fermé maintenant (ex. 22h pour demain 10h). La validité du
  //     créneau en lui-même est vérifiée plus bas (chevauchement horaires).
  const opening: OpeningHours = normalizeOpeningHours(
    merchant.opening_hours as Partial<OpeningHours> | null
  );
  if (input.pickup_type === "asap" && !isOpenNow(opening)) {
    return {
      ok: false,
      error:
        "Le commerce est fermé pour le moment. Choisis un créneau plus tard pour passer ta commande.",
    };
  }

  // Validation mode de paiement accepté.
  if (input.payment_method === "cash" && !merchant.accepts_cash) {
    return {
      ok: false,
      error: "Ce commerce n'accepte pas le paiement en espèces.",
    };
  }
  // COD (mig 0116, façon Yassir) : pas de blocage des comptes neufs. Le COD est
  // dispo SAUF blocage dur (super-admin) via customer_cod_allowed = !cod_blocked.
  // Gate UNIQUEMENT sur la livraison COD (le retrait en boutique se paie sur place).
  if (
    input.payment_method === "cash" &&
    input.fulfillment_type === "delivery"
  ) {
    const { data: codOk } = await supabase.rpc(
      "customer_cod_allowed" as never,
      {
        p_customer_id: customer.id,
      } as never
    );
    if (codOk !== true) {
      return {
        ok: false,
        error:
          "Le paiement en espèces à la livraison n'est pas disponible sur ce compte. " +
          "Règle en ligne ou via Coligo Pay (commande payée d'avance).",
      };
    }
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
       max_uses, max_uses_per_customer, uses_count, financeur,
       promotion_products ( product_id )`
    )
    .eq("merchant_id", merchant.id)
    .eq("status", "active");

  // Quotas par promo (plafonds d'usage) pour la validation anti-fraude du code.
  const quotaById = new Map<
    string,
    { maxUses: number | null; maxPerCustomer: number | null; usesCount: number }
  >();
  // Financeur par promo (snapshot immuable sur la commande). Défaut 'merchant'.
  const financeurById = new Map<string, string>();

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
      max_uses: number | null;
      max_uses_per_customer: number | null;
      uses_count: number | null;
      financeur: string | null;
      promotion_products: { product_id: string }[];
    }[]
  ).map((p) => {
    quotaById.set(p.id, {
      maxUses: p.max_uses,
      maxPerCustomer: p.max_uses_per_customer,
      usesCount: p.uses_count ?? 0,
    });
    financeurById.set(p.id, p.financeur ?? "merchant");
    return {
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
    };
  });

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

  // ---------------------------------------------------------------------------
  // 5-bis. CODE PROMO — validation serveur (le client a vu une estimation, le
  // serveur tranche). Si un code est saisi mais invalide/épuisé → on REFUSE
  // pour que le montant affiché reste honnête. Financeur = merchant (la promo
  // baisse le net ; la commission se calcule sur ce net → plateforme jamais
  // perdante). uses_count + journal d'usage gérés via redeem_promo après insert.
  // ---------------------------------------------------------------------------
  const codeTyped = (input.promo_code ?? "").trim();
  if (codeTyped) {
    if (!settled.promoCode) {
      return { ok: false, error: "Code promo invalide ou expiré." };
    }
    const quota = quotaById.get(settled.promoCode.id);
    if (quota) {
      if (quota.maxUses != null && quota.usesCount >= quota.maxUses) {
        return { ok: false, error: "Ce code promo n'est plus disponible." };
      }
      if (quota.maxPerCustomer != null) {
        const { count } = await (
          supabase.from("promotion_redemptions" as never) as unknown as {
            select: (
              c: string,
              o: { count: "exact"; head: true }
            ) => {
              eq: (
                c: string,
                v: string
              ) => {
                eq: (
                  c: string,
                  v: string
                ) => PromiseLike<{ count: number | null }>;
              };
            };
          }
        )
          .select("id", { count: "exact", head: true })
          .eq("promotion_id", settled.promoCode.id)
          .eq("customer_id", customer.id);
        if ((count ?? 0) >= quota.maxPerCustomer) {
          return { ok: false, error: "Tu as déjà utilisé ce code promo." };
        }
      }
    }
  }
  const appliedPromo = settled.promoCode;

  // Snapshot immuable (PARTIE B) : prix produits AVANT promo (gross) et APRÈS
  // promo (net = base figée de la commission). La réduction se déduit
  // (gross − net). Le financeur est figé sur la commande (défaut 'merchant' ;
  // aucune logique plateforme n'est codée — la plateforme ne perd rien).
  const grossTotalDa = settled.normalTotalDa;
  const netTotalDa = settled.totalDa;
  const promoFinanceur = appliedPromo
    ? (financeurById.get(appliedPromo.id) ?? "merchant")
    : null;

  // Minimum de commande — résolution PLANCHER plateforme + surcharge commerçant.
  // S'applique sur le total APRÈS promos (avant cashback/topup, pour empêcher
  // un contournement via le wallet).
  const minOrder = resolveMinOrderDa(
    input.payment_method,
    merchant.min_order_da
  );
  if (settled.totalDa < minOrder) {
    return {
      ok: false,
      error: `Le minimum de commande est de ${minOrder} DA.`,
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
    // Fenêtre max J+N selon le commerçant (défaut 7 jours).
    const maxAhead = merchant.max_days_ahead ?? 7;
    const limit = Date.now() + maxAhead * 24 * 60 * 60_000;
    if (start.getTime() > limit) {
      return {
        ok: false,
        error: `Ce commerce accepte les commandes jusqu'à ${maxAhead} jour${maxAhead > 1 ? "s" : ""} à l'avance.`,
      };
    }
    // Refuse un créneau qui tombe dans une fermeture programmée du commerce.
    if (merchant.closure_start && merchant.closure_end) {
      const cs = new Date(merchant.closure_start);
      const ce = new Date(merchant.closure_end);
      if (start >= cs && start < ce) {
        return {
          ok: false,
          error:
            "Ce commerce est fermé à cette date. Choisis un autre créneau.",
        };
      }
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

  // ---------------------------------------------------------------------------
  // 5a-bis. FRAIS DE SERVICE — calculés sur (subtotal - discount).
  //   - cashback EXCLU des frais (on ne donne pas de cashback sur ses propres
  //     frais ; on ne soustrait pas non plus le cashback du panier produits
  //     pour le calcul des frais — c'est le ticket BRUT du commerçant qui
  //     détermine le tier).
  //   - tiers lus depuis platform_settings.service_fee_tiers (JSONB).
  //   - figé dans orders.service_fee_da. Source de vérité pour le trigger.
  // ---------------------------------------------------------------------------
  const { data: settingsRow } = await supabase
    .from("platform_settings")
    .select("service_fee_tiers, cashback_online, cashback_cash")
    .eq("id", true)
    .maybeSingle();
  const serviceFeeTiers = parseTiers(settingsRow?.service_fee_tiers);
  const productsDa = settled.totalDa; // = subtotal - discount, AVANT wallet

  // Estimation cashback AFFICHÉE (display only ; le montant réellement versé est
  // recalculé par le trigger 0118 sur le panier net). On utilise les taux
  // globaux selon le mode de paiement (cash gagne désormais cashback_cash).
  const cashbackRate =
    input.payment_method === "online"
      ? Number(settingsRow?.cashback_online ?? 0.03)
      : Number(settingsRow?.cashback_cash ?? 0);
  const cashbackEstimate = Math.round(productsDa * cashbackRate);
  let serviceFeeDa = computeServiceFeeDa(productsDa, serviceFeeTiers);

  // PÉNALITÉ NO-SHOW (mig 0116) : si le client a un no-show non soldé, sa
  // prochaine commande a des frais de service RELEVÉS mais PLAFONNÉS à 100 DA
  // (douceur volontaire — priorité = garder la confiance, façon Yassir). Le
  // drapeau noshow_pending se lève automatiquement dès cette commande honorée.
  const NOSHOW_PENALTY_SF_DA = 100;
  if (customer.noshow_pending === true) {
    serviceFeeDa = Math.min(
      NOSHOW_PENALTY_SF_DA,
      Math.max(serviceFeeDa, NOSHOW_PENALTY_SF_DA)
    );
  }

  // ---------------------------------------------------------------------------
  // 5b. Cashback DÉPENSÉ par le client — recalcul serveur :
  //   - jamais > solde du client
  //   - jamais > total avant cashback (produits + service_fee)
  //   - figé dans la commande (snapshot)
  // Le trigger SQL `spend_customer_cashback_on_order_create` génère l'écriture
  // négative dans le ledger client à l'INSERT de la commande.
  // ---------------------------------------------------------------------------
  const totalBeforeWallets = productsDa + serviceFeeDa;
  let cashbackUsed = 0;
  if ((input.cashback_to_use_da ?? 0) > 0) {
    const balance = await getCashbackBalanceForCustomer(customer.id);
    const requested = Math.max(0, Math.floor(input.cashback_to_use_da ?? 0));
    cashbackUsed = Math.min(requested, balance, totalBeforeWallets);
  }
  const totalAfterCashback = Math.max(0, totalBeforeWallets - cashbackUsed);

  // -------------------------------------------------------------------------
  // 5c. Coligo Pay (topup) DÉPENSÉ — recalcul serveur.
  // -------------------------------------------------------------------------
  let topupUsed = 0;
  if ((input.topup_to_use_da ?? 0) > 0) {
    const topupBalance = await getTopupBalanceForCustomer(customer.id);
    const requested = Math.max(0, Math.floor(input.topup_to_use_da ?? 0));
    topupUsed = Math.min(requested, topupBalance, totalAfterCashback);
  }
  const totalAfterWallets = Math.max(0, totalAfterCashback - topupUsed);

  // -------------------------------------------------------------------------
  // 5d. Garde-fou Chargily — refus AVANT toute écriture DB.
  //   Chargily Pay v2 impose amount >= 50 DZD. Si le total après cashback/
  //   topup est dans la fenêtre (0, 50[, on refuse net plutôt que créer une
  //   commande pending qui ne pourra jamais être payée.
  //   Le cas totalAfterWallets === 0 reste valide (cashback couvre tout :
  //   bascule directe à paid sans appel Chargily — cf. plus bas).
  // -------------------------------------------------------------------------
  if (
    input.payment_method === "online" &&
    totalAfterWallets > 0 &&
    totalAfterWallets < CHARGILY_MIN_AMOUNT_DA
  ) {
    return {
      ok: false,
      error:
        `Le paiement en ligne nécessite un minimum de ${CHARGILY_MIN_AMOUNT_DA} DA à régler. ` +
        `Réduis le cashback/Coligo Pay utilisé, ou choisis le paiement en espèces.`,
    };
  }

  // -------------------------------------------------------------------------
  // 5e. Livraison — calculs serveur (snapshot prix + adresse + capacité).
  //     On NE FAIT JAMAIS confiance au client pour le prix (PARTIE A — barème
  //     imposé). On recalcule avec computeDeliveryFee + Haversine ici.
  // -------------------------------------------------------------------------
  const isDelivery = input.fulfillment_type === "delivery";
  let deliveryFeeDa = 0;
  let deliverySnapshot: {
    address_id: string | null;
    lat: number;
    lng: number;
    text: string | null;
    phone: string | null;
    distance_km: number;
    mode: "express" | "tour";
    slot_id: string | null;
  } | null = null;

  if (isDelivery) {
    // merchants_public n'expose pas les flags livraison ni lat/lng → requête
    // dédiée (RLS autorise la lecture publique des champs publics ; au pire
    // on filtre côté code).
    const { data: merchDelivery } = await supabase
      .from("merchants")
      .select(
        "delivery_enabled, express_enabled, tours_enabled, delivery_radius_km, latitude, longitude"
      )
      .eq("id", merchant.id)
      .maybeSingle();
    if (!merchDelivery?.delivery_enabled) {
      return {
        ok: false,
        error: "La livraison n'est pas activée pour ce commerçant.",
      };
    }
    if (input.delivery_mode !== "express" && input.delivery_mode !== "tour") {
      return { ok: false, error: "Mode de livraison invalide." };
    }
    if (input.delivery_mode === "express" && !merchDelivery.express_enabled) {
      return {
        ok: false,
        error: "L'Express n'est pas activé chez ce commerçant.",
      };
    }
    if (input.delivery_mode === "tour" && !merchDelivery.tours_enabled) {
      return {
        ok: false,
        error: "Les tournées ne sont pas activées chez ce commerçant.",
      };
    }
    if (merchDelivery.latitude == null || merchDelivery.longitude == null) {
      return {
        ok: false,
        error: "Le commerçant n'a pas configuré sa position.",
      };
    }

    // Source de la position client : EITHER adresse enregistrée, EITHER
    // position custom posée sur la carte (au moins l'une des deux).
    let addrId: string | null = null;
    let addrLat: number;
    let addrLng: number;
    let addrText: string | null = null;
    let addrPhone: string | null = null;

    if (
      input.delivery_custom_lat != null &&
      input.delivery_custom_lng != null
    ) {
      if (
        input.delivery_custom_lat < -90 ||
        input.delivery_custom_lat > 90 ||
        input.delivery_custom_lng < -180 ||
        input.delivery_custom_lng > 180
      ) {
        return { ok: false, error: "Position de livraison invalide." };
      }
      addrLat = input.delivery_custom_lat;
      addrLng = input.delivery_custom_lng;
      // Adresse lisible résolue côté client (reverse-geocode du point pointé).
      addrText =
        input.delivery_custom_address_text?.trim()?.slice(0, 200) || null;
    } else if (input.delivery_address_id) {
      const { data: addr } = await supabase
        .from("customer_addresses")
        .select("id, lat, lng, address_text, phone_override")
        .eq("id", input.delivery_address_id)
        .eq("customer_id", customer.id)
        .maybeSingle();
      if (!addr) {
        return { ok: false, error: "Adresse introuvable." };
      }
      addrId = addr.id;
      addrLat = addr.lat;
      addrLng = addr.lng;
      addrText = addr.address_text;
      addrPhone = addr.phone_override;
    } else {
      return {
        ok: false,
        error:
          "Position de livraison requise. Choisis une adresse ou pointe ta position sur la carte.",
      };
    }

    // Barème global + rayon commerçant.
    const { data: ps } = await supabase
      .from("platform_settings")
      .select(
        "delivery_base_da, delivery_per_km_da, delivery_free_km_threshold, delivery_min_da, delivery_max_da, delivery_max_radius_km"
      )
      .eq("id", true)
      .maybeSingle();
    if (!ps) return { ok: false, error: "Barème livraison indisponible." };

    const distanceKm = haversineKm(
      { lat: merchDelivery.latitude, lng: merchDelivery.longitude },
      { lat: addrLat, lng: addrLng }
    );
    const quote = computeDeliveryFee(
      distanceKm,
      ps,
      merchDelivery.delivery_radius_km
    );
    if (quote.outOfRange) {
      return {
        ok: false,
        error: `Hors zone de livraison (${distanceKm.toFixed(1)} km). Choisis le retrait sur place.`,
      };
    }
    deliveryFeeDa = quote.feeDa;

    // TOURNÉE : le prix n'est PAS le barème mais le tarif que le commerçant a
    // fixé par bande de distance (≤ plafond barème, garanti par le trigger
    // serveur 0119). On recalcule depuis ses zones — jamais de confiance client.
    if (input.delivery_mode === "tour") {
      const { data: zones } = await supabase
        .from("merchant_delivery_zones")
        .select("band_index, max_km, price_da")
        .eq("merchant_id", merchant.id);
      const tourQuote = computeTourDeliveryFee(
        distanceKm,
        (zones ?? []).map((z) => ({
          band_index: z.band_index,
          max_km: Number(z.max_km),
          price_da: z.price_da,
        })),
        ps,
        merchDelivery.delivery_radius_km
      );
      if (tourQuote.outOfRange) {
        return {
          ok: false,
          error: `Hors zone de livraison (${distanceKm.toFixed(1)} km). Choisis le retrait sur place.`,
        };
      }
      deliveryFeeDa = tourQuote.feeDa;
    }

    // Tournée : vérifier la capacité du créneau choisi.
    if (input.delivery_mode === "tour") {
      if (!input.delivery_slot_id) {
        return { ok: false, error: "Choisis un créneau pour la tournée." };
      }
      const { data: slot } = await supabase
        .from("delivery_slots")
        .select("id, max_orders, status, merchant_id")
        .eq("id", input.delivery_slot_id)
        .eq("merchant_id", merchant.id)
        .maybeSingle();
      if (!slot || slot.status !== "open") {
        return { ok: false, error: "Ce créneau n'est plus disponible." };
      }
      // Compteur SECURITY DEFINER (0164) : un count direct tournerait sous RLS
      // client et ne verrait que les commandes du client lui-même → la capacité
      // ne serait jamais appliquée. Le trigger enforce_slot_capacity reste le
      // garde-fou atomique à l'INSERT (anti race condition).
      const { data: slotCount } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>
        ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
      ).call(supabase, "slot_orders_count", { p_slot_id: slot.id });
      if (((slotCount as number | null) ?? 0) >= slot.max_orders) {
        return {
          ok: false,
          error: "Ce créneau est complet. Choisis-en un autre.",
        };
      }
    }

    // Téléphone communiqué au livreur : priorité au numéro saisi par le client,
    // sinon celui de l'adresse enregistrée, sinon le numéro du profil client.
    // Une livraison SANS aucun numéro joignable est refusée (le livreur ne
    // pourrait pas contacter le client).
    const deliveryPhone =
      input.delivery_phone_override?.trim() ||
      addrPhone?.trim() ||
      customer.phone?.trim() ||
      "";
    if (!isValidContactPhone(deliveryPhone)) {
      return {
        ok: false,
        error:
          "Numéro de livraison invalide. Saisis un mobile algérien valide (0X XX XX XX XX).",
      };
    }

    deliverySnapshot = {
      address_id: addrId,
      lat: addrLat,
      lng: addrLng,
      text: addrText,
      phone: deliveryPhone,
      distance_km: Number(distanceKm.toFixed(2)),
      mode: input.delivery_mode,
      slot_id:
        input.delivery_mode === "tour"
          ? (input.delivery_slot_id ?? null)
          : null,
    };
  }

  const totalWithDelivery = totalAfterWallets + deliveryFeeDa;

  // Cast localisé : promo_id/promo_code/promo_financeur/gross_total_da/
  // net_total_da ne sont pas encore dans database.types.ts généré (Docker
  // requis pour gen types). On caste le builder en gardant le typage du retour.
  const { data: order, error: orderErr } = await (
    supabase.from("orders") as unknown as {
      insert: (v: Record<string, unknown>) => {
        select: (c: string) => {
          single: () => Promise<{
            data: { id: string; pickup_code: string } | null;
            error: { code?: string; message: string } | null;
          }>;
        };
      };
    }
  )
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
      // subtotal_da = somme des lignes APRÈS réductions produit (= ce qui est
      // affiché). discount_da = code promo SEUL (les réductions produit sont
      // déjà fondues dans les prix de ligne → pas de double comptage).
      subtotal_da: settled.subtotalDa,
      discount_da: settled.promoCode?.discountDa ?? 0,
      // Snapshot immuable de la base de commission (PARTIE B).
      gross_total_da: grossTotalDa,
      net_total_da: netTotalDa,
      promo_id: appliedPromo?.id ?? null,
      promo_code: appliedPromo?.code ?? null,
      promo_financeur: promoFinanceur,
      total_da: totalWithDelivery,
      cashback_used_da: cashbackUsed,
      topup_used_da: topupUsed,
      service_fee_da: serviceFeeDa,
      cashback_da: 0,
      cashback_estimate_da: cashbackEstimate,
      commission_da: 0, // figé à la complétion par le trigger wallet (sur le net)
      fulfillment_type: isDelivery ? "delivery" : "pickup",
      delivery_mode: deliverySnapshot?.mode ?? null,
      delivery_fee_da: deliveryFeeDa,
      delivery_address_id: deliverySnapshot?.address_id ?? null,
      delivery_address_text: deliverySnapshot?.text ?? null,
      delivery_lat: deliverySnapshot?.lat ?? null,
      delivery_lng: deliverySnapshot?.lng ?? null,
      delivery_phone: deliverySnapshot?.phone ?? null,
      delivery_recipient_name:
        isDelivery && input.delivery_recipient_name
          ? input.delivery_recipient_name.slice(0, 80)
          : null,
      delivery_distance_km: deliverySnapshot?.distance_km ?? null,
      delivery_slot_id: deliverySnapshot?.slot_id ?? null,
      delivery_note:
        isDelivery && input.delivery_note
          ? input.delivery_note.slice(0, 300)
          : null,
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
    // Garde-fou capacité créneau (trigger 0164) : course perdue entre le
    // pré-check et l'INSERT.
    if (orderErr?.message?.includes("slot_full")) {
      return {
        ok: false,
        error: "Ce créneau est complet. Choisis-en un autre.",
      };
    }
    if (orderErr?.message?.includes("slot_not_open")) {
      return { ok: false, error: "Ce créneau n'est plus disponible." };
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

  // Code promo : journal d'usage (incrémente uses_count, idempotent via
  // UNIQUE(order_id, promotion_id)). Le snapshot est déjà figé dans l'insert.
  // Best-effort : n'échoue jamais la commande.
  if (appliedPromo) {
    try {
      await supabase.rpc(
        "redeem_promo" as never,
        {
          p_promotion_id: appliedPromo.id,
          p_order_id: order.id,
          p_customer_id: customer.id,
          p_code: appliedPromo.code,
          p_discount_da: appliedPromo.discountDa,
        } as never
      );
    } catch (e) {
      console.warn("[createOrder] redeem_promo failed:", e);
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Paiement en ligne — création du checkout Chargily.
  //
  // IMPORTANT (correctif trésorerie) : on facture `totalWithDelivery`, c.-à-d.
  // produits + frais de service + LIVRAISON − cashback − Coligo Pay. La livraison
  // DOIT être encaissée en ligne (sinon la plateforme paie le livreur/commerçant
  // une livraison jamais payée par le client).
  //
  // Cas où totalWithDelivery === 0 (le wallet couvre tout, livraison comprise) :
  // aucun paiement nécessaire → on bascule directement à `payment_status = paid`.
  // ---------------------------------------------------------------------------
  let checkoutUrl: string | undefined;
  if (input.payment_method === "online") {
    if (totalWithDelivery === 0) {
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
          amount: totalWithDelivery,
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

  // Notification commerçant — UNIQUEMENT si la commande est déjà effective pour
  // lui. Un paiement EN LIGNE pas encore confirmé (checkoutUrl renvoyé) NE doit
  // RIEN déclencher côté commerçant : ni push, ni board (RLS le masque tant que
  // payment_status <> 'paid'). C'est le webhook Chargily qui notifiera à la
  // confirmation du paiement. Le cash et l'online déjà soldé (cashback couvre
  // tout) notifient immédiatement.
  const onlineAwaitingPayment =
    input.payment_method === "online" && checkoutUrl != null;
  if (!onlineAwaitingPayment) {
    void notifyMerchantNewOrder({
      merchantId: merchant.id,
      orderId: order.id,
      customerName: customer.full_name,
      totalDa: totalAfterWallets,
    });
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
      "id, status, pickup_code, payment_method, payment_status, total_da, customer_id, client_operation_id"
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
  // Une commande définitivement annulée par le webhook (status='cancelled')
  // ne peut plus être relancée — le client doit repasser via son panier.
  // (Le cashback / topup éventuellement utilisé a déjà été re-crédité par
  // les triggers refund_customer_*_on_cancel.)
  if (order.status === "cancelled") {
    return {
      ok: false,
      error: "Cette commande a été annulée. Repasse depuis ton panier.",
    };
  }
  if (order.total_da <= 0) {
    return { ok: false, error: "Montant invalide." };
  }
  if (order.total_da < CHARGILY_MIN_AMOUNT_DA) {
    return {
      ok: false,
      error: `Le paiement en ligne nécessite un minimum de ${CHARGILY_MIN_AMOUNT_DA} DA.`,
    };
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

// =============================================================================
// Aperçu CODE PROMO (estimation client). Le serveur tranche à la création de
// commande (createOrder) ; ici on renvoie juste la remise estimée ou l'erreur.
// =============================================================================
export type PromoPreview =
  | { ok: true; discount_da: number; code: string }
  | { ok: false; error: string };

export async function previewPromoCode(input: {
  merchant_id: string;
  items: { product_id: string; quantity: number }[];
  code: string;
}): Promise<PromoPreview> {
  try {
    const code = (input.code ?? "").trim();
    if (!code) return { ok: false, error: "Saisis un code promo." };
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Reconnecte-toi." };
    const { data: customer } = await supabase
      .from("customers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!customer) return { ok: false, error: "Profil client introuvable." };

    const ids = input.items.map((i) => i.product_id);
    if (ids.length === 0) return { ok: false, error: "Panier vide." };
    const { data: prods } = await supabase
      .from("products")
      .select("id, price_da")
      .eq("merchant_id", input.merchant_id)
      .in("id", ids);
    const priceById = new Map(
      (prods ?? []).map((p) => [p.id as string, p.price_da as number])
    );
    const lines = input.items
      .filter((i) => priceById.has(i.product_id))
      .map((i) => ({
        productId: i.product_id,
        quantity: i.quantity,
        unitPriceDa: priceById.get(i.product_id)!,
      }));
    if (lines.length === 0) return { ok: false, error: "Panier vide." };

    const { data: promosRaw } = await supabase
      .from("promotions")
      .select(
        `id, type, status, discount_kind, discount_value, code, buy_qty, get_qty,
         starts_at, ends_at, max_uses, max_uses_per_customer, uses_count,
         promotion_products ( product_id )`
      )
      .eq("merchant_id", input.merchant_id)
      .eq("status", "active");

    const rows = (promosRaw ?? []) as unknown as {
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
      max_uses: number | null;
      max_uses_per_customer: number | null;
      uses_count: number | null;
      promotion_products: { product_id: string }[];
    }[];

    const promotions: EnginePromotion[] = rows.map((p) => ({
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

    const settled = computeCart(lines, promotions, {
      minPriceDa: APP_CONFIG.promotions.minPriceDa,
      commissionRate: APP_CONFIG.commission.rate,
      promoCode: code,
    });
    if (!settled.promoCode) {
      return { ok: false, error: "Code promo invalide ou expiré." };
    }
    const raw = rows.find((p) => p.id === settled.promoCode!.id);
    if (raw?.max_uses != null && (raw.uses_count ?? 0) >= raw.max_uses) {
      return { ok: false, error: "Ce code promo n'est plus disponible." };
    }
    if (raw?.max_uses_per_customer != null) {
      const { count } = await (
        supabase.from("promotion_redemptions" as never) as unknown as {
          select: (
            c: string,
            o: { count: "exact"; head: true }
          ) => {
            eq: (
              c: string,
              v: string
            ) => {
              eq: (
                c: string,
                v: string
              ) => PromiseLike<{ count: number | null }>;
            };
          };
        }
      )
        .select("id", { count: "exact", head: true })
        .eq("promotion_id", settled.promoCode.id)
        .eq("customer_id", customer.id);
      if ((count ?? 0) >= raw.max_uses_per_customer) {
        return { ok: false, error: "Tu as déjà utilisé ce code promo." };
      }
    }
    return {
      ok: true,
      discount_da: settled.promoCode.discountDa,
      code: settled.promoCode.code,
    };
  } catch (e) {
    console.warn("[previewPromoCode] failed:", e);
    return { ok: false, error: "Vérification impossible. Réessaie." };
  }
}
