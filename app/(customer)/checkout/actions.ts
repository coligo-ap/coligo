"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NATIVE_COOKIE } from "@/lib/config/native";
import {
  computeCart,
  isPromotionActive,
  type EnginePromotion,
} from "@/lib/promotions/engine";
import { loadLineOptions } from "@/lib/checkout/option-pricing";
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
import { getEffectiveFlags } from "@/lib/data/feature-flags";
import { getCustomerFraudGate } from "@/lib/fraud/gate";
import {
  createCheckout as createChargilyCheckout,
  buildCallbackUrls,
} from "@/lib/payments/chargily";
import {
  CHARGILY_MIN_AMOUNT_DA,
  resolveMinOrderDa,
} from "@/lib/config/payment-limits";
import { computeServiceFeeDa, parseTiers } from "@/lib/finance/service-fee";
import { fraudRecordEvent } from "@/lib/fraud/events";
import { notifyMerchantNewOrder, notifyDriversTour } from "@/lib/fcm/triggers";
import {
  computeDeliveryFee,
  computeTourDeliveryFee,
} from "@/lib/delivery/pricing";
import { haversineKm } from "@/lib/delivery/distance";
import { evaluateZone, logZoneBlock } from "@/lib/zones/server";
import {
  issuePriceQuote,
  verifyPriceQuote,
  quoteRejectionMessage,
} from "@/lib/data/geo-quote";
import { zoneMessageFr } from "@/lib/zones/service-zones";
import { reverseGeocode } from "@/app/(customer)/actions";
import type { OpeningHours, PaymentMethod } from "@/lib/types";
import { formatQty, isValidQty } from "@/lib/units";
import {
  checkIntlEligibility,
  getRequestCountry,
  type IntlRefusal,
} from "@/lib/payments/intl";
import {
  createIntlPaymentIntent,
  getPublishableKey,
} from "@/lib/payments/stripe";

export type CreateOrderInput = {
  merchant_id: string;
  client_operation_id: string;
  items: {
    product_id: string;
    quantity: number;
    /** Options/variantes choisies (ids → revalidées serveur, jamais le prix). */
    options?: { option_id: string }[];
  }[];
  pickup_type: "asap" | "slot";
  pickup_slot_start?: string | null; // ISO
  pickup_slot_end?: string | null; // ISO
  payment_method: PaymentMethod;
  /**
   * Rail du paiement en ligne : "chargily" (défaut — CIB/EDAHABIA en DA) ou
   * "stripe_eur" (carte internationale, montant EUR calculé serveur au taux
   * maison — jamais exposé). La commande reste `payment_method='online'` en
   * base dans les deux cas : aucun trigger financier ne change.
   */
  online_rail?: "chargily" | "stripe_eur" | null;
  /** Identifiant d'appareil (anti-fraude promos — lib/customer/device-id). */
  device_id?: string | null;
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
  /**
   * Devis signé (Partie D) émis par `issueDeliveryQuote` pour l'adresse de
   * livraison affichée. Vérifié+consommé ici : si l'adresse a CHANGÉ depuis
   * l'estimation, la commande est refusée (le client re-confirme). Le tarif
   * reste recalculé serveur de façon autoritaire — le devis ne fait que lier
   * la commande à l'adresse vue par le client.
   */
  delivery_quote_id?: string | null;
  /**
   * PANIER PARTAGÉ « Faire payer un proche » (mig 0405/0406) : crée la commande
   * online `pending` SANS créer de session Chargily (personne ne l'ouvrirait
   * ici — l'invité génère la sienne, token-validée, sur /payer/{ptoken}).
   * Le webhook et toute la suite restent strictement identiques.
   */
  defer_payment?: boolean;
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
      /**
       * Rail stripe_eur : PAIEMENT EMBARQUÉ dans la page (Payment Element —
       * carte + Apple Pay + Google Pay). `client_secret` est FAIT pour le
       * client ; le montant € affiché sur le bouton vient d'ici (le taux,
       * lui, ne sort jamais). Le webhook reste la seule source de vérité.
       */
      stripe_intent?: {
        client_secret: string;
        publishable_key: string;
        eur_cents: number;
        /** Total DA réellement couvert — affiché en référence sur la feuille. */
        total_da: number;
      };
    }
  | { ok: false; error: string };

/**
 * Émet un DEVIS SIGNÉ pour l'adresse de livraison affichée (Partie D). Le
 * checkout l'appelle quand le client choisit/pose son adresse ; le `quoteId`
 * est repassé à `createOrder`, qui refuse la commande si l'adresse a changé
 * depuis. Best-effort : null si échec (non bloquant). Le tarif affiché (meta)
 * est informatif — le serveur recalcule toujours le prix autoritaire.
 */
export async function issueDeliveryQuote(input: {
  lat: number;
  lng: number;
  address_text?: string | null;
  fee_da: number;
  mode: "express" | "tour";
}): Promise<{ quoteId: string } | null> {
  const q = await issuePriceQuote({
    context: "delivery",
    pickup: {
      lat: input.lat,
      lng: input.lng,
      text: input.address_text ?? null,
    },
    dest: null,
    priceDa: input.fee_da,
    meta: { mode: input.mode },
  });
  return q ? { quoteId: q.quoteId } : null;
}

/** Message FR pour un refus de paiement international (rail stripe_eur) —
 *  jamais de taux ni de montant EUR dans ces messages côté client. */
function intlRefusalMessage(reason: IntlRefusal): string {
  switch (reason) {
    case "country":
      return "Le paiement en euros n'est pas disponible dans ta région.";
    case "order_min":
      return "Montant trop faible pour un paiement en euros — paye autrement.";
    case "order_max":
      return "Montant trop élevé pour un paiement en euros — réduis le panier ou paye autrement.";
    case "user_day":
    case "user_month":
      return "Tu as atteint ton plafond de paiements en euros. Réessaye plus tard.";
    case "capacity":
      return "Les paiements en euros sont momentanément indisponibles. Réessaye bientôt.";
    default:
      return "Le paiement en euros est momentanément indisponible.";
  }
}

/** Message FR pour un refus de code PLATEFORME, selon la raison renvoyée par
 *  la RPC `validate_platform_promo`. */
function platformPromoErrorMessage(reason: string): string {
  switch (reason) {
    case "app_only":
      return "Ce code est réservé à l'application mobile Coligo — télécharge l'app pour en profiter.";
    case "device_used":
      return "Vous avez déjà bénéficié de cette promotion sur cet appareil.";
    case "online_only":
      return "Ce code n'est valable qu'avec un paiement en ligne (Coligo Pay ou carte).";
    case "min_subtotal":
      return "Le montant de ta commande n'atteint pas le minimum requis pour ce code.";
    case "not_eligible":
      return "Ce code ne t'est pas attribué.";
    case "exhausted":
      return "Ce code a atteint sa limite d'utilisation.";
    case "per_customer_limit":
      return "Tu as déjà utilisé ce code le nombre de fois autorisé.";
    case "inactive":
      return "Ce code n'est plus actif.";
    default:
      return "Code promo invalide ou expiré.";
  }
}

/**
 * La commande est-elle PAYÉE (preuve = webhook → payment_status='paid') ?
 * Sondée par l'overlay de résultat natif du checkout — on ne croit jamais la
 * redirection, seulement le webhook. Scopée au client connecté (RLS).
 */
export async function isOrderPaid(orderId: string): Promise<boolean> {
  if (!orderId) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("payment_status")
    .eq("id", orderId)
    .maybeSingle();
  return (
    (data as { payment_status?: string } | null)?.payment_status === "paid"
  );
}

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

  // Anti-fraude (mig 0374) : compte suspendu OU avertissement obligatoire non
  // lu → pas de nouvelle commande (défense en profondeur — la popup bloquante
  // est montée par le layout client).
  const fraudGate = await getCustomerFraudGate();
  if (fraudGate.suspended) {
    return {
      ok: false,
      error: "Ton compte est suspendu. Contacte le support Coligo.",
    };
  }
  if (fraudGate.readonly) {
    return {
      ok: false,
      error:
        "Votre compte est en lecture seule. Vous pouvez consulter vos commandes, mais pas en passer de nouvelle.",
    };
  }
  if (fraudGate.requireAck) {
    return {
      ok: false,
      error:
        "Un avertissement important t'attend sur l'accueil — lis-le et confirme pour continuer.",
    };
  }

  // Disponibilité (super-admin) : refuse le paiement en ligne désactivé, et
  // neutralise l'usage de cashback / Coligo Pay s'ils sont coupés. (La DB pose
  // aussi un garde-fou bypass-proof sur les commandes online — mig 0182.)
  const features = await getEffectiveFlags();
  if (
    input.payment_method === "online" &&
    features.online_payment.status !== "active"
  ) {
    return {
      ok: false,
      error: "Le paiement en ligne est momentanément indisponible.",
    };
  }
  if (features.cashback.status !== "active") input.cashback_to_use_da = 0;
  if (features.coligo_pay.status !== "active") input.topup_to_use_da = 0;

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
      existing.total_da > 0 &&
      // Paiement DIFFÉRÉ (panier partagé) : ne pas régénérer une session que
      // personne n'ouvrira — l'invité crée la sienne sur /payer/{ptoken}.
      !input.defer_payment
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
  // Plafond de dette espèces (mig 0269) : si le commerçant a atteint son
  // plafond, on refuse PROPREMENT les nouvelles commandes espèces qui
  // creuseraient la dette (retrait + tournée). L'express COD est exclu (le
  // livreur custodie le cash). Le trigger serveur reste le filet anti-contournement.
  if (
    input.payment_method === "cash" &&
    !(
      input.fulfillment_type === "delivery" && input.delivery_mode === "express"
    )
  ) {
    const { data: cashBlocked } = await supabase.rpc(
      "merchant_cash_blocked" as never,
      { p_merchant: input.merchant_id } as never
    );
    if (cashBlocked === true) {
      return {
        ok: false,
        error:
          "Le paiement en espèces est momentanément indisponible pour ce commerce. " +
          "Choisissez le paiement en ligne ou Coligo Pay.",
      };
    }
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
    .select(
      "id, merchant_id, name_fr, name_ar, unit, price_da, is_available, stock_qty, min_qty, max_qty"
    )
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
  }

  // Quantités : validation STRICTE ligne par ligne (entier à la pièce,
  // fractionnaire 2 déc. max pour kg/L/m — on REFUSE plutôt que corriger,
  // le montant affiché doit rester le montant facturé), puis stock par
  // PRODUIT (somme des lignes — un même produit peut avoir plusieurs lignes
  // avec des options différentes).
  const qtyByProduct = new Map<string, number>();
  for (const it of input.items) {
    const p = products.find((pp) => pp.id === it.product_id)!;
    if (!isValidQty(it.quantity, p.unit)) {
      return {
        ok: false,
        error: `Quantité invalide pour « ${p.name_fr} ».`,
      };
    }
    // Minimum PAR LIGNE fixé par le commerçant (ex. min 500 g / 2 pièces).
    const minQty = p.min_qty == null ? null : Number(p.min_qty);
    if (minQty != null && it.quantity < minQty - 1e-9) {
      return {
        ok: false,
        error: `Quantité minimum pour « ${p.name_fr} » : ${formatQty(minQty, p.unit)}.`,
      };
    }
    qtyByProduct.set(
      it.product_id,
      (qtyByProduct.get(it.product_id) ?? 0) + it.quantity
    );
  }
  for (const p of products) {
    const totalQty = qtyByProduct.get(p.id) ?? 0;
    // Maximum PAR COMMANDE fixé par le commerçant (somme des lignes).
    const maxQty = p.max_qty == null ? null : Number(p.max_qty);
    if (maxQty != null && totalQty > maxQty + 1e-9) {
      return {
        ok: false,
        error: `Quantité maximum par commande pour « ${p.name_fr} » : ${formatQty(maxQty, p.unit)}.`,
      };
    }
    if (p.stock_qty != null && totalQty > p.stock_qty) {
      return {
        ok: false,
        error: `Stock insuffisant pour « ${p.name_fr} » (max ${p.stock_qty}).`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // 4-bis. OPTIONS/VARIANTES — revalidation SERVEUR (jamais le prix client),
  // via le helper partagé avec l'aperçu (affiché == facturé). Snapshot par ligne
  // (libellés FR/AR + delta), même index que input.items / lines / settled.lines.
  // ---------------------------------------------------------------------------
  const { perLine: lineOptions, deltaPerLine: lineOptionsDelta } =
    await loadLineOptions(supabase, input.items);

  // ---------------------------------------------------------------------------
  // 5. Charge les promos actives + calcul via le MOTEUR (source de vérité).
  // ---------------------------------------------------------------------------
  const { data: promosRaw } = await supabase
    .from("promotions")
    .select(
      `id, merchant_id, type, status, title_fr, title_ar, discount_kind,
       discount_value, code, buy_qty, get_qty, min_subtotal_da, starts_at,
       ends_at, max_uses, max_uses_per_customer, uses_count, financeur,
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
      min_subtotal_da: number | null;
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
      minSubtotalDa: p.min_subtotal_da,
      productIds: (p.promotion_products ?? []).map((x) => x.product_id),
      startsAt: p.starts_at,
      endsAt: p.ends_at,
    };
  });

  const lines = input.items.map((it, idx) => {
    const p = products.find((pp) => pp.id === it.product_id)!;
    return {
      productId: it.product_id,
      quantity: it.quantity,
      // Prix de base + Σ deltas des options (revalidés serveur).
      unitPriceDa: p.price_da + lineOptionsDelta[idx],
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
  // Code PLATEFORME éventuel (financé Coligo, cross-commerçant). Renseigné
  // seulement si le code saisi N'EST PAS un code commerçant et qu'il valide.
  let platformPromo: { id: string; code: string; discountDa: number } | null =
    null;
  if (codeTyped) {
    if (settled.promoCode) {
      // --- Code COMMERÇANT : contrôle des plafonds (existant). ---
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
    } else {
      // --- Pas un code commerçant → tenter un code PLATEFORME (v1 en ligne). ---
      // La RPC tranche (fenêtre, plafonds, éligibilité, online_only) et renvoie
      // la remise. On lui passe le total APRÈS réductions produit (settled.totalDa
      // == subtotal ici, aucun code commerçant appliqué).
      // Anti-fraude (mig 0381) : app installée = cookie natif posé par
      // /api/start (jamais une valeur envoyée par le client) + identifiant
      // d'appareil pour la mémoire « déjà bénéficié ».
      const isApp = (await cookies()).get(NATIVE_COOKIE)?.value === "1";
      const { data: vpRaw } = await supabase.rpc(
        "validate_platform_promo" as never,
        {
          p_code: codeTyped,
          p_customer_id: customer.id,
          p_subtotal_da: settled.totalDa,
          p_payment_method: input.payment_method,
          p_is_app: isApp,
          p_device_id: input.device_id ?? null,
        } as never
      );
      const vp = (Array.isArray(vpRaw) ? vpRaw[0] : vpRaw) as {
        valid: boolean;
        promotion_id: string | null;
        code: string | null;
        discount_da: number | null;
        reason: string | null;
      } | null;
      if (vp?.valid && vp.promotion_id) {
        platformPromo = {
          id: vp.promotion_id,
          code: vp.code ?? codeTyped.toUpperCase(),
          discountDa: Math.max(0, vp.discount_da ?? 0),
        };
      } else {
        // Tentatives de contournement (hors app / appareil déjà servi) →
        // journal anti-fraude : visibles dans le moteur (scores, alertes),
        // fire-and-forget, ne bloque jamais la réponse.
        const reason = vp?.reason ?? "invalid";
        if (reason === "app_only" || reason === "device_used") {
          fraudRecordEvent({
            actorKind: "customer",
            actorId: customer.id,
            eventType: "promo_denied",
            meta: {
              code: codeTyped.toUpperCase(),
              reason,
              device_id: input.device_id ?? null,
              stage: "order",
            },
          });
        }
        return {
          ok: false,
          error: platformPromoErrorMessage(reason),
        };
      }
    }
  }
  const appliedPromo = settled.promoCode;

  // Remise plateforme : réduit le total PAYÉ par le client, jamais le net dû au
  // commerçant (cf. trigger apply_platform_promo_on_paid, mig 0292).
  const platformDiscountDa = platformPromo
    ? Math.min(platformPromo.discountDa, settled.totalDa)
    : 0;
  // Ce que le client paie pour les produits (net commerçant − remise plateforme).
  const clientGoodsDa = Math.max(0, settled.totalDa - platformDiscountDa);

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
  // 5a-bis. FRAIS DE SERVICE — assiette = ce que le client PAIE RÉELLEMENT.
  //   - Palier calculé sur le panier NET FINAL (clientGoodsDa) : après
  //     promotions/offres/réductions commerçant ET après code promo plateforme.
  //     Une grosse promo fait donc retomber le panier dans le palier payant —
  //     plus de gratuité « héritée » du brut, plus de garde-fou séparé.
  //   - cashback / Coligo Pay EXCLUS de l'assiette (moyens de paiement, pas
  //     des remises) ; tiers lus depuis platform_settings.
  //   - ANTI-FRAUDE : tout est recalculé ICI depuis la DB (prix produits,
  //     promos, code) — les montants affichés/envoyés par le navigateur ne
  //     sont jamais crus. Figé dans orders.service_fee_da, rendu immuable par
  //     le trigger protect_order_financial_fields (mig 0166).
  // ---------------------------------------------------------------------------
  const { data: settingsRow } = await supabase
    .from("platform_settings")
    .select("service_fee_tiers, cashback_online, cashback_cash")
    .eq("id", true)
    .maybeSingle();
  const serviceFeeTiers = parseTiers(settingsRow?.service_fee_tiers);
  const productsDa = settled.totalDa; // NET après promos, AVANT wallet

  // Estimation cashback AFFICHÉE (display only ; le montant réellement versé est
  // recalculé par le trigger 0118 sur le panier net). On utilise les taux
  // globaux selon le mode de paiement (cash gagne désormais cashback_cash).
  const cashbackRate =
    input.payment_method === "online"
      ? Number(settingsRow?.cashback_online ?? 0.03)
      : Number(settingsRow?.cashback_cash ?? 0);
  const cashbackEstimate = Math.round(productsDa * cashbackRate);
  let serviceFeeDa = computeServiceFeeDa(clientGoodsDa, serviceFeeTiers);

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
  // Base FACTURÉE au client = produits APRÈS remise plateforme + frais service.
  // (productsDa reste le NET commerçant, base commission/cashback, inchangé.)
  const totalBeforeWallets = clientGoodsDa + serviceFeeDa;
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
    wilaya_code: string | null;
    commune: string | null;
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
    // Kill-switch PLATEFORME (feature_flags) : l'insert passe par service_role
    // (pour interdire tout insert direct forgé), or le trigger SQL
    // `enforce_feature_delivery_mode` ne s'applique qu'aux rôles authenticated/
    // anon → on applique donc la garde ICI, en amont (miroir de
    // feature_blocked = status <> 'active').
    if (
      input.delivery_mode === "express" &&
      features.express.status !== "active"
    ) {
      return {
        ok: false,
        error:
          "La livraison express est momentanément indisponible. Choisis le retrait sur place ou réessaie plus tard.",
      };
    }
    if (input.delivery_mode === "tour" && features.tour.status !== "active") {
      return {
        ok: false,
        error:
          "La livraison en tournée est momentanément indisponible. Choisis le retrait sur place ou réessaie plus tard.",
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

    // Anti-prix-périmé (Partie D) : si un devis a été émis pour l'adresse
    // affichée, on vérifie qu'elle n'a pas changé depuis. On NE bloque QUE sur
    // « adresse changée » (vraie incohérence) ; expiré/introuvable n'empêche pas
    // la commande car le tarif est recalculé serveur juste après (autoritaire).
    if (input.delivery_quote_id) {
      const chk = await verifyPriceQuote({
        quoteId: input.delivery_quote_id,
        context: "delivery",
        pickup: { lat: addrLat, lng: addrLng },
        consume: true,
      });
      if (!chk.ok && chk.reason === "addr_changed") {
        return { ok: false, error: quoteRejectionMessage(chk.reason) };
      }
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

      // Livraison offerte (mig 0331) — TOURNÉE UNIQUEMENT : le commerçant fait
      // sa propre livraison et l'ASSUME. Si une offre free_delivery est active et
      // que le sous-total (après réductions produit) atteint son minimum → 0.
      // Coligo garde sa commission PRODUITS (calculée sur le net, hors livraison,
      // par le trigger wallet). L'EXPRESS n'est jamais concerné (le livreur
      // indépendant doit être payé). Autoritaire : recalculé ici, pas de confiance
      // au client.
      const nowFd = new Date();
      const hasFreeDelivery = promotions.some(
        (p) =>
          p.type === "free_delivery" &&
          isPromotionActive(p, nowFd) &&
          (p.minSubtotalDa == null || settled.subtotalDa >= p.minSubtotalDa)
      );
      if (hasFreeDelivery) deliveryFeeDa = 0;
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

    // MOTEUR DE ZONES (mig 0169) : la destination est-elle couverte pour ce
    // mode (express/tour) ? On résout wilaya/commune en best-effort (reverse-
    // geocode, borné dans le temps) pour appliquer aussi les règles
    // administratives ; le check géométrique (rayon/polygone/pays) ne dépend que
    // du lat/lng. Le trigger SQL (0169) reste le garde-fou bypass-proof.
    let deliveryWilaya: string | null = null;
    let deliveryCommune: string | null = null;
    try {
      const rg = (await Promise.race([
        reverseGeocode({ latitude: addrLat, longitude: addrLng }),
        new Promise((resolve) => setTimeout(() => resolve(null), 2500)),
      ])) as { wilaya_code?: string | null; commune?: string | null } | null;
      deliveryWilaya = rg?.wilaya_code ?? null;
      deliveryCommune = rg?.commune ?? null;
    } catch {
      /* reverse-geocode best-effort : on continue avec le check géométrique */
    }

    const zone = await evaluateZone(input.delivery_mode, addrLat, addrLng, {
      wilayaCode: deliveryWilaya,
      commune: deliveryCommune,
      role: "destination",
    });
    if (!zone.allowed) {
      void logZoneBlock({
        service: input.delivery_mode,
        source: "order",
        role: "destination",
        reason: zone.reason,
        lat: addrLat,
        lng: addrLng,
        wilayaCode: deliveryWilaya,
        commune: deliveryCommune,
      });
      return {
        ok: false,
        error: zoneMessageFr(zone, "destination", input.delivery_mode),
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
      wilaya_code: deliveryWilaya,
      commune: deliveryCommune,
    };
  }

  // LIVRAISON OFFERTE (Roue Coligo, mig 0421) : consommation automatique du
  // plus ancien crédit actif. Règles : commande LIVRÉE avec frais > 0, NON
  // cumulable avec un code promo plateforme. Le frais livreur reste RÉEL
  // (jamais fee=0 — mig 0103) : la remise est financée par Coligo (ledger
  // promo_expense au paiement, trigger 0421). Consommation OPTIMISTE gardée
  // par status='active' (anti double-usage concurrent) ; consumed_order_id
  // posé après l'INSERT, crédit relâché si l'INSERT échoue.
  let deliveryCreditDa = 0;
  let deliveryCreditId: string | null = null;
  // (deliveryFeeDa > 0 ⇒ commande LIVRÉE : le retrait n'a jamais de frais.)
  if (deliveryFeeDa > 0 && !platformPromo) {
    const adminDb = createAdminClient();
    const { data: credit } = await (
      adminDb.from("customer_delivery_credits" as never) as unknown as {
        select: (c: string) => {
          eq: (
            c: string,
            v: string
          ) => {
            eq: (
              c: string,
              v: string
            ) => {
              gt: (
                c: string,
                v: string
              ) => {
                order: (
                  c: string,
                  o: { ascending: boolean }
                ) => {
                  limit: (n: number) => {
                    maybeSingle: () => Promise<{
                      data: { id: string; max_fee_da: number } | null;
                    }>;
                  };
                };
              };
            };
          };
        };
      }
    )
      .select("id, max_fee_da")
      .eq("customer_id", customer.id)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .order("granted_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (credit) {
      const { data: locked } = await (
        adminDb.from("customer_delivery_credits" as never) as unknown as {
          update: (v: Record<string, unknown>) => {
            eq: (
              c: string,
              v: string
            ) => {
              eq: (
                c: string,
                v: string
              ) => {
                select: (c: string) => {
                  maybeSingle: () => Promise<{ data: { id: string } | null }>;
                };
              };
            };
          };
        }
      )
        .update({ status: "consumed", consumed_at: new Date().toISOString() })
        .eq("id", credit.id)
        .eq("status", "active")
        .select("id")
        .maybeSingle();
      if (locked) {
        deliveryCreditDa = Math.min(deliveryFeeDa, credit.max_fee_da);
        deliveryCreditId = credit.id;
      }
    }
  }

  const totalWithDelivery =
    totalAfterWallets + deliveryFeeDa - deliveryCreditDa;

  // ANTI-FRAUDE (durcissement) : la commande + ses lignes sont écrites via le
  // client service_role (`writeDb`), JAMAIS le client utilisateur. Combiné au
  // retrait des policies RLS INSERT côté client (mig 0349), un INSERT PostgREST
  // direct par un client (rôle authenticated) est désormais REJETÉ → il est
  // impossible de forger les montants (service_fee, total, net…). Le seul chemin
  // de création passe par cette Server Action, qui recalcule TOUT depuis la DB.
  // Les montants posés ici sont donc autoritaires ; les triggers de gating qui
  // tournent aussi pour service_role (créneau, dette commerçant, feature online,
  // dépense wallet, génération pickup_code) restent actifs ; ceux réservés à
  // authenticated (zone, feature livraison) sont revalidés en TS plus haut.
  const writeDb = createAdminClient();

  // Cast localisé : promo_id/promo_code/promo_financeur/gross_total_da/
  // net_total_da ne sont pas encore dans database.types.ts généré (Docker
  // requis pour gen types). On caste le builder en gardant le typage du retour.
  const { data: order, error: orderErr } = await (
    writeDb.from("orders") as unknown as {
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
      // Code PLATEFORME (financé Coligo) — snapshot. La compta (journal +
      // promo_expense) est posée par le trigger à la confirmation du paiement.
      platform_promo_id: platformPromo?.id ?? null,
      platform_promo_code: platformPromo?.code ?? null,
      platform_discount_da: platformDiscountDa,
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
      // Livraison offerte (roue) : remise financée Coligo, fee livreur intact.
      delivery_credit_id: deliveryCreditId,
      delivery_credit_da: deliveryCreditDa,
      delivery_address_id: deliverySnapshot?.address_id ?? null,
      delivery_address_text: deliverySnapshot?.text ?? null,
      delivery_lat: deliverySnapshot?.lat ?? null,
      delivery_lng: deliverySnapshot?.lng ?? null,
      delivery_wilaya_code: deliverySnapshot?.wilaya_code ?? null,
      delivery_commune: deliverySnapshot?.commune ?? null,
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
    // Crédit livraison réservé mais commande non créée → on le RELÂCHE
    // (best-effort) pour que le client ne perde pas son gain.
    if (deliveryCreditId) {
      void (
        createAdminClient().from(
          "customer_delivery_credits" as never
        ) as unknown as {
          update: (v: Record<string, unknown>) => {
            eq: (c: string, v: string) => PromiseLike<unknown>;
          };
        }
      )
        .update({ status: "active", consumed_at: null })
        .eq("id", deliveryCreditId);
    }
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
    // Compte suspendu par l'équipe Coligo (trigger 0397) : on le dit
    // franchement plutôt que de laisser une erreur technique.
    if (orderErr?.message?.includes("account_blocked")) {
      return {
        ok: false,
        error:
          "Votre compte est suspendu : les commandes sont bloquées. Contactez le support Coligo.",
      };
    }
    // Paiement en ligne coupé sur ce compte (trigger 0397).
    if (orderErr?.message?.includes("feature_disabled:online_payment")) {
      return {
        ok: false,
        error:
          "Le paiement en ligne n'est pas disponible sur votre compte. Choisissez le paiement à la livraison ou contactez le support.",
      };
    }
    // Kill-switch livraison (trigger 0324) : service coupé entre l'affichage
    // et l'INSERT.
    if (orderErr?.message?.includes("feature_disabled:express")) {
      return {
        ok: false,
        error:
          "La livraison express est momentanément indisponible. Choisis le retrait sur place ou réessaie plus tard.",
      };
    }
    if (orderErr?.message?.includes("feature_disabled:tour")) {
      return {
        ok: false,
        error:
          "La livraison en tournée est momentanément indisponible. Choisis le retrait sur place ou réessaie plus tard.",
      };
    }
    // Plafond de dette espèces du commerçant (trigger 0269).
    if (orderErr?.message?.includes("merchant_cash_debt_cap")) {
      return {
        ok: false,
        error:
          "Ce commerce ne peut plus accepter de paiement en espèces pour le moment. Choisis le paiement en ligne.",
      };
    }
    // Garde-fou ZONE (trigger 0169) : zone bloquée entre le pré-check et
    // l'INSERT (ex. l'admin vient de restreindre la zone).
    if (orderErr?.message?.includes("service_zone_blocked")) {
      return {
        ok: false,
        error: deliverySnapshot
          ? zoneMessageFr(
              {
                allowed: false,
                reason: orderErr.message.includes("service_inactive")
                  ? "service_inactive"
                  : "blocked",
                label: null,
                coming_soon: false,
              },
              "destination",
              deliverySnapshot.mode
            )
          : "Cette destination n'est pas encore couverte.",
      };
    }
    return {
      ok: false,
      error: orderErr?.message ?? "Erreur à la création de la commande.",
    };
  }

  // Crédit livraison consommé → rattacher la commande (traçabilité admin).
  if (deliveryCreditId) {
    void (
      writeDb.from("customer_delivery_credits" as never) as unknown as {
        update: (v: Record<string, unknown>) => {
          eq: (c: string, v: string) => PromiseLike<unknown>;
        };
      }
    )
      .update({ consumed_order_id: order.id })
      .eq("id", deliveryCreditId);
  }

  // MÉMOIRE D'APPAREIL anti-fraude (mig 0381) : ce couple (promo, appareil)
  // est marqué — un AUTRE compte sur le même appareil ne pourra plus utiliser
  // ce code (« Vous avez déjà bénéficié de cette promotion »). Best-effort,
  // idempotent (PK), service_role.
  if (platformPromo && input.device_id) {
    void (
      writeDb.from("platform_promo_device_marks" as never) as unknown as {
        upsert: (
          row: Record<string, unknown>,
          opts: { onConflict: string; ignoreDuplicates: boolean }
        ) => PromiseLike<{ error: { message: string } | null }>;
      }
    )
      .upsert(
        {
          promotion_id: platformPromo.id,
          device_id: input.device_id,
          customer_id: customer.id,
        },
        { onConflict: "promotion_id,device_id", ignoreDuplicates: true }
      )
      .then(({ error: markErr }) => {
        if (markErr) {
          console.warn("[createOrder] promo device mark:", markErr.message);
        }
      });
  }

  // Lignes (snapshot prix unitaire effectif + ligne + unité + nom AR). L'ordre
  // de settled.lines suit input.items → même index que lineOptions.
  const itemsRows = settled.lines.map((l) => {
    const product = products.find((p) => p.id === l.productId)!;
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
  const { data: insertedItems, error: itemsErr } = await writeDb
    .from("order_items")
    .insert(itemsRows)
    .select("id");
  if (itemsErr || !insertedItems) {
    // Compensation : si les items échouent, on annule la commande.
    await writeDb.from("orders").delete().eq("id", order.id);
    return {
      ok: false,
      error: `Erreur ajout articles : ${itemsErr?.message ?? "inconnue"}`,
    };
  }

  // Snapshot des OPTIONS choisies par ligne (libellés FR/AR + delta figés).
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
    await writeDb.from("order_item_options").insert(optionRows);
  }

  // Snapshot des PROMOTIONS appliquées (type + titre FR/AR + montant + offerts),
  // pour le ticket et la traçabilité. Best-effort (n'échoue pas la commande).
  const promoInfo = new Map(
    (
      (promosRaw ?? []) as unknown as {
        id: string;
        type: string;
        title_fr: string;
        title_ar: string | null;
        code: string | null;
      }[]
    ).map((p) => [p.id, p])
  );
  const promoAgg = new Map<string, { discount: number; free: number }>();
  for (const l of settled.lines) {
    if (l.productPromotionId) {
      const cur = promoAgg.get(l.productPromotionId) ?? {
        discount: 0,
        free: 0,
      };
      cur.discount += Math.round(
        (l.unitPriceDa - l.appliedUnitPriceDa) * l.paidQuantity
      );
      promoAgg.set(l.productPromotionId, cur);
    }
    if (l.quantityPromotionId && l.freeUnits > 0) {
      const cur = promoAgg.get(l.quantityPromotionId) ?? {
        discount: 0,
        free: 0,
      };
      cur.discount += Math.round(l.appliedUnitPriceDa * l.freeUnits);
      cur.free += l.freeUnits;
      promoAgg.set(l.quantityPromotionId, cur);
    }
  }
  let promoPos = 0;
  const promoSnapshotRows = [...promoAgg.entries()].flatMap(([pid, a]) => {
    const info = promoInfo.get(pid);
    if (!info) return [];
    return [
      {
        order_id: order.id,
        promotion_id: pid,
        type: info.type,
        title_fr: info.title_fr,
        title_ar: info.title_ar,
        code: info.code,
        discount_da: a.discount,
        free_qty: a.free,
        position: promoPos++,
      },
    ];
  });
  if (appliedPromo) {
    const info = promoInfo.get(appliedPromo.id);
    promoSnapshotRows.push({
      order_id: order.id,
      promotion_id: appliedPromo.id,
      type: info?.type ?? "promo_code",
      title_fr: info?.title_fr ?? appliedPromo.code,
      title_ar: info?.title_ar ?? null,
      code: appliedPromo.code,
      discount_da: appliedPromo.discountDa,
      free_qty: 0,
      position: promoPos++,
    });
  }
  if (promoSnapshotRows.length > 0) {
    await writeDb.from("order_promotions").insert(promoSnapshotRows);
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
  // Paiement DIFFÉRÉ (panier partagé « Faire payer un proche ») : commande
  // online `pending` sans session Chargily — le commerçant doit rester muet
  // exactement comme quand une session est ouverte mais pas encore payée.
  let deferredOnline = false;
  if (input.payment_method === "online") {
    if (totalWithDelivery === 0) {
      // Le wallet couvre tout (livraison comprise) → aucun paiement Chargily.
      // Écriture via service_role : le client n'a aucune policy UPDATE sur
      // orders (l'update user-client était un no-op silencieux → commande
      // bloquée en 'pending'). protect_order_financial_fields ne bride que les
      // rôles authenticated/anon, donc service_role peut confirmer.
      await writeDb
        .from("orders")
        .update({ payment_status: "paid" })
        .eq("id", order.id);
    } else if (input.online_rail === "stripe_eur") {
      // ── Rail INTERNATIONAL (Stripe, EUR) — PAIEMENT EMBARQUÉ dans la page
      // (Payment Element : carte + Apple Pay + Google Pay). Le taux maison
      // reste serveur. Re-vérification AUTORITAIRE (pays, plafonds, taux) au
      // moment T : la visibilité affichée plus tôt ne fait pas foi.
      try {
        const elig = await checkIntlEligibility({
          customerId: customer.id,
          totalDa: totalWithDelivery,
          domain: "marketplace",
          mode: "authoritative",
        });
        if (!elig.ok) {
          return { ok: false, error: intlRefusalMessage(elig.reason) };
        }
        const publishableKey = await getPublishableKey();
        if (!publishableKey) {
          return {
            ok: false,
            error: "Paiement en euros momentanément indisponible.",
          };
        }
        // ANTI-DOUBLE-DÉBIT : neutralise les intents précédents de CETTE
        // commande (re-soumission) + balaye les sessions abandonnées.
        const { supersedeStaleSessions, sweepStaleIntlSessions } =
          await import("@/lib/payments/intl-guard");
        await supersedeStaleSessions(writeDb, { orderId: order.id });
        void sweepStaleIntlSessions();
        const intent = await createIntlPaymentIntent({
          orderId: order.id,
          eurCents: elig.eur_cents!,
          description: `Commande Coligo #${order.pickup_code}`,
          metadata: {
            type: "order",
            order_id: order.id,
            client_operation_id: input.client_operation_id,
            customer_id: customer.id,
          },
        });
        // Session tracée (plafonds + audit + rapprochement webhook). Échec
        // d'écriture = paiement REFUSÉ (on ne laisse jamais partir un
        // paiement qu'on ne saurait pas rapprocher).
        const { error: sessErr } = await (
          writeDb.from("intl_payment_sessions" as never) as unknown as {
            insert: (row: Record<string, unknown>) => Promise<{
              error: { message: string } | null;
            }>;
          }
        ).insert({
          order_id: order.id,
          customer_id: customer.id,
          stripe_payment_intent: intent.id,
          eur_cents: elig.eur_cents!,
          total_da: totalWithDelivery,
          rate_da: elig.rate.rate_da,
          rate_source: elig.rate.source,
          ip_country: await getRequestCountry(),
        });
        if (sessErr) {
          console.error("[createOrder] intl session insert:", sessErr.message);
          return {
            ok: false,
            error: "Commande créée mais paiement indisponible. Réessaye.",
          };
        }
        revalidatePath("/commandes");
        return {
          ok: true,
          order_id: order.id,
          pickup_code: order.pickup_code,
          stripe_intent: {
            client_secret: intent.clientSecret,
            publishable_key: publishableKey,
            eur_cents: elig.eur_cents!,
            total_da: totalWithDelivery,
          },
        };
      } catch (e) {
        // Commande conservée : le client peut réessayer (idempotent via
        // client_operation_id), comme sur le rail Chargily.
        return {
          ok: false,
          error:
            e instanceof Error
              ? `Commande créée mais paiement indisponible : ${e.message}`
              : "Commande créée mais paiement indisponible.",
        };
      }
    } else if (input.defer_payment) {
      deferredOnline = true;
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
    input.payment_method === "online" &&
    (checkoutUrl != null || deferredOnline);
  if (!onlineAwaitingPayment) {
    void notifyMerchantNewOrder({
      merchantId: merchant.id,
      orderId: order.id,
      customerName: customer.full_name,
      totalDa: totalAfterWallets,
    });
    // Tournée : prévient les livreurs inscrits du commerçant (no-op si la
    // commande n'est pas en tournée). Push reçu même app fermée / hors ligne.
    void notifyDriversTour({ orderId: order.id });
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
export type RetryPaymentResult =
  | {
      ok: true;
      /** Rail Chargily : URL de la page de paiement hébergée. */
      checkout_url?: string;
      /** Rail € : feuille EMBARQUÉE (même payload que createOrder). */
      stripe_intent?: {
        client_secret: string;
        publishable_key: string;
        eur_cents: number;
        /** Total DA réellement couvert — affiché en référence sur la feuille. */
        total_da: number;
      };
    }
  | { ok: false; error: string };

export async function retryOnlineOrderPayment(
  orderId: string
): Promise<RetryPaymentResult> {
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

  try {
    const { successUrl, failureUrl, webhookEndpoint } = buildCallbackUrls({
      context: "order",
      orderId: order.id,
    });

    // Rail d'ORIGINE : une commande partie en Stripe (EUR) se relance en
    // Stripe — jamais de bascule silencieuse de rail (montants et devise
    // différents). Détection : une session intl existe pour cette commande.
    const admin = createAdminClient();
    const { data: intlRows } = await (
      admin.from("intl_payment_sessions" as never) as unknown as {
        select: (cols: string) => {
          eq: (
            c: string,
            v: unknown
          ) => {
            order: (
              c: string,
              o: { ascending: boolean }
            ) => {
              limit: (n: number) => Promise<{
                data: Record<string, unknown>[] | null;
              }>;
            };
          };
        };
      }
    )
      .select("id, status")
      .eq("order_id", order.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const isIntl = (intlRows ?? []).length > 0;

    if (isIntl) {
      // Rail € : nouveau PaymentIntent → feuille EMBARQUÉE (comme au
      // checkout — plus de page hébergée non plus au retry).
      const elig = await checkIntlEligibility({
        customerId: customer.id,
        totalDa: order.total_da,
        domain: "marketplace",
        mode: "authoritative",
      });
      if (!elig.ok) {
        return { ok: false, error: intlRefusalMessage(elig.reason) };
      }
      const publishableKey = await getPublishableKey();
      if (!publishableKey) {
        return {
          ok: false,
          error: "Paiement en euros momentanément indisponible.",
        };
      }
      // ANTI-DOUBLE-DÉBIT : le retry remplace l'intent précédent — l'ancien
      // est annulé chez Stripe (session marquée 'expired' d'abord).
      const { supersedeStaleSessions, sweepStaleIntlSessions } =
        await import("@/lib/payments/intl-guard");
      await supersedeStaleSessions(admin, { orderId: order.id });
      void sweepStaleIntlSessions();
      const intent = await createIntlPaymentIntent({
        orderId: order.id,
        eurCents: elig.eur_cents!,
        description: `Commande Coligo #${order.pickup_code}`,
        metadata: {
          type: "order",
          order_id: order.id,
          client_operation_id: order.client_operation_id ?? "",
          customer_id: customer.id,
        },
      });
      const { error: sessErr } = await (
        admin.from("intl_payment_sessions" as never) as unknown as {
          insert: (row: Record<string, unknown>) => Promise<{
            error: { message: string } | null;
          }>;
        }
      ).insert({
        order_id: order.id,
        customer_id: customer.id,
        stripe_payment_intent: intent.id,
        eur_cents: elig.eur_cents!,
        total_da: order.total_da,
        rate_da: elig.rate.rate_da,
        rate_source: elig.rate.source,
        ip_country: await getRequestCountry(),
      });
      if (sessErr) {
        console.error("[retryOnline] intl session insert:", sessErr.message);
        return { ok: false, error: "Paiement indisponible. Réessaye." };
      }
      if (order.payment_status === "failed") {
        await supabase
          .from("orders")
          .update({ payment_status: "pending" })
          .eq("id", order.id);
      }
      return {
        ok: true,
        stripe_intent: {
          client_secret: intent.clientSecret,
          publishable_key: publishableKey,
          eur_cents: elig.eur_cents!,
          total_da: order.total_da,
        },
      };
    }

    // Rail Chargily (DA) — minimum imposé par Chargily.
    if (order.total_da < CHARGILY_MIN_AMOUNT_DA) {
      return {
        ok: false,
        error: `Le paiement en ligne nécessite un minimum de ${CHARGILY_MIN_AMOUNT_DA} DA.`,
      };
    }
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
  items: {
    product_id: string;
    quantity: number;
    options?: { option_id: string }[];
  }[];
  code: string;
  /** Identifiant d'appareil (anti-fraude — même valeur qu'à createOrder). */
  device_id?: string | null;
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
    const { deltaPerLine } = await loadLineOptions(supabase, input.items);
    const lines = input.items
      .map((i, idx) =>
        priceById.has(i.product_id)
          ? {
              productId: i.product_id,
              quantity: i.quantity,
              unitPriceDa: priceById.get(i.product_id)! + deltaPerLine[idx],
            }
          : null
      )
      .filter(
        (
          l
        ): l is { productId: string; quantity: number; unitPriceDa: number } =>
          !!l
      );
    if (lines.length === 0) return { ok: false, error: "Panier vide." };

    const { data: promosRaw } = await supabase
      .from("promotions")
      .select(
        `id, type, status, discount_kind, discount_value, code, buy_qty, get_qty,
         min_subtotal_da, starts_at, ends_at, max_uses, max_uses_per_customer,
         uses_count, promotion_products ( product_id )`
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
      min_subtotal_da: number | null;
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
      minSubtotalDa: p.min_subtotal_da,
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
      // Message ciblé : code valide mais sous-total sous le minimum exigé.
      const wanted = code.trim().toUpperCase();
      const belowMin = rows.find(
        (p) =>
          p.type === "promo_code" &&
          (p.code ?? "").trim().toUpperCase() === wanted &&
          p.min_subtotal_da != null &&
          settled.subtotalDa < p.min_subtotal_da
      );
      if (belowMin?.min_subtotal_da != null) {
        return {
          ok: false,
          error: `Ce code s'applique dès ${belowMin.min_subtotal_da} DA d'achats.`,
        };
      }
      // Pas un code commerçant → tenter un code PLATEFORME. L'aperçu suppose un
      // paiement EN LIGNE (les codes plateforme sont online-only en v1) ;
      // createOrder revérifie selon le mode réellement choisi.
      const { data: vpRaw } = await supabase.rpc(
        "validate_platform_promo" as never,
        {
          p_code: code,
          p_customer_id: customer.id,
          p_subtotal_da: settled.totalDa,
          p_payment_method: "online",
          p_is_app: (await cookies()).get(NATIVE_COOKIE)?.value === "1",
          p_device_id: input.device_id ?? null,
        } as never
      );
      const vp = (Array.isArray(vpRaw) ? vpRaw[0] : vpRaw) as {
        valid: boolean;
        code: string | null;
        discount_da: number | null;
        reason: string | null;
      } | null;
      if (vp?.valid) {
        return {
          ok: true,
          discount_da: Math.max(0, vp.discount_da ?? 0),
          code: vp.code ?? code.toUpperCase(),
        };
      }
      const vpReason = vp?.reason ?? "invalid";
      if (vpReason === "app_only" || vpReason === "device_used") {
        // Journal anti-fraude (fire-and-forget) — même signal qu'au checkout.
        fraudRecordEvent({
          actorKind: "customer",
          actorId: customer.id,
          eventType: "promo_denied",
          meta: {
            code: code.toUpperCase(),
            reason: vpReason,
            device_id: input.device_id ?? null,
            stage: "preview",
          },
        });
      }
      return {
        ok: false,
        error: platformPromoErrorMessage(vpReason),
      };
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
