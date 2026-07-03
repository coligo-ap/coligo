"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  ChevronRight,
  Clock,
  CreditCard,
  Gift,
  Loader2,
  Check,
  Receipt,
  ShoppingCart,
  Sparkles,
  Store,
  Tag,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { clearCart, useCart, useOtherCarts } from "@/lib/customer/cart-store";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { CartConflictModal } from "@/components/customer/cart-conflict-modal";
import { generateSlotsForRange, type Slot } from "@/lib/customer/pickup-slots";
import {
  formatAsapReady,
  formatDayRelative,
} from "@/lib/customer/pickup-format";
import { isOpenNow, normalizeOpeningHours } from "@/lib/merchant/opening-hours";
import {
  computeDeliveryFee,
  computeTourDeliveryFee,
} from "@/lib/delivery/pricing";
import { haversineKm } from "@/lib/delivery/distance";
import type { OpeningHours } from "@/lib/types";
import {
  fetchCheckoutContext,
  type CheckoutContext,
} from "@/app/(customer)/checkout/context";
import {
  createOrder,
  issueDeliveryQuote,
  previewPromoCode,
} from "@/app/(customer)/checkout/actions";
import { trackBeginCheckout } from "@/lib/analytics/ecommerce";
import { CHARGILY_MIN_AMOUNT_DA } from "@/lib/config/payment-limits";
import type { FeatureStatus } from "@/lib/data/feature-flags";
import type { PaymentMethod } from "@/lib/types";
import {
  CheckoutDeliverySection,
  type DeliveryChoice,
} from "./checkout-delivery-section";

type Props = {
  customer: {
    full_name: string;
    phone: string;
    latitude?: number | null;
    longitude?: number | null;
  };
  /** Disponibilité (super-admin) — gèle/masque paiement en ligne, Coligo Pay, cashback. */
  onlinePaymentStatus?: FeatureStatus;
  coligoPayStatus?: FeatureStatus;
  cashbackStatus?: FeatureStatus;
};

export function CheckoutView({
  customer,
  onlinePaymentStatus = "active",
  coligoPayStatus = "active",
  cashbackStatus = "active",
}: Props) {
  // Raccourcis de disponibilité (super-admin).
  const onlineVisible = onlinePaymentStatus !== "hidden";
  const onlineUsable = onlinePaymentStatus === "active";
  const coligoPayOn = coligoPayStatus === "active";
  const cashbackOn = cashbackStatus === "active";
  const t = useTranslations("checkout");
  const tc = useTranslations("cart");
  const router = useRouter();
  const cart = useCart();
  const otherCarts = useOtherCarts();
  const savedLoc = useCustomerLocation();
  const [ctx, setCtx] = useState<CheckoutContext | null>(null);
  const [loading, startLoad] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [pickupType, setPickupType] = useState<"asap" | "slot">("asap");
  const [chosenSlotIdx, setChosenSlotIdx] = useState<number | null>(null);
  const [chosenDayKey, setChosenDayKey] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [delivery, setDelivery] = useState<DeliveryChoice>({
    fulfillment: "pickup",
    addressId: null,
    customPosition: null,
    customAddressText: null,
    positionConfirmed: false,
    mode: null,
    slotId: null,
    phoneOverride: "",
    recipientName: "",
    deliveryNote: "",
  });
  const [conflictDismissed, setConflictDismissed] = useState(false);
  const showConflict = otherCarts.length > 0 && !conflictDismissed;
  // Cashback NON sélectionné par défaut (le client l'active via le toggle).
  const [useCashback, setUseCashback] = useState(false);
  const [useTopup, setUseTopup] = useState(true);
  const [isRedirecting, setIsRedirecting] = useState(false);
  // Lignes repliables compactes (mockup) : promo + note s'ouvrent au tap.
  const [promoOpen, setPromoOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  // Re-déclenche l'anim « bump » du total quand on bascule un solde.
  const [walletBump, setWalletBump] = useState(0);
  // Code promo : saisie + code validé côté serveur (estimation ; le serveur
  // retranche et revalide à la création de la commande).
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    discount_da: number;
  } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoChecking, startPromoCheck] = useTransition();

  // Charge le contexte serveur (merchant + recalcul prix) dès qu'on a un cart.
  useEffect(() => {
    if (!cart.merchant_id || cart.items.length === 0) {
      setCtx(null);
      return;
    }
    startLoad(async () => {
      const data = await fetchCheckoutContext({
        merchant_id: cart.merchant_id!,
        items: cart.items.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          options: i.options?.map((o) => ({ option_id: o.option_id })),
        })),
      });
      setCtx(data);
    });
  }, [cart]);

  // Si le panier change, l'estimation du code promo n'est plus garantie →
  // on l'efface (le client réapplique ; le serveur reste juge final).
  const itemsSig = cart.items
    .map((i) => `${i.product_id}:${i.quantity}`)
    .join(",");
  useEffect(() => {
    setAppliedPromo(null);
    setPromoError(null);
  }, [itemsSig]);

  // Force "cash" si l'online n'est pas accepté OU désactivé par le super-admin.
  useEffect(() => {
    if (
      payment === "online" &&
      (!ctx?.merchant.accepts_online || !onlineUsable)
    ) {
      setPayment("cash");
    }
  }, [ctx, payment, onlineUsable]);

  // Désactive l'usage des soldes si la fonctionnalité est coupée (super-admin).
  useEffect(() => {
    if (!cashbackOn) setUseCashback(false);
  }, [cashbackOn]);
  useEffect(() => {
    if (!coligoPayOn) setUseTopup(false);
  }, [coligoPayOn]);

  const savedPosition = useMemo(() => {
    const lat = savedLoc?.latitude ?? customer.latitude ?? null;
    const lng = savedLoc?.longitude ?? customer.longitude ?? null;
    return lat != null && lng != null ? { lat, lng } : null;
  }, [savedLoc, customer.latitude, customer.longitude]);

  const slotsByDay = useMemo(() => {
    if (!ctx) return new Map<string, Slot[]>();
    const hours = normalizeOpeningHours(
      ctx.merchant.opening_hours as Partial<OpeningHours> | null
    );
    return generateSlotsForRange(hours, {
      slotMinutes: ctx.merchant.pickup_slot_minutes,
      prepMinutes: ctx.merchant.prep_time_min,
      daysAhead: ctx.merchant.max_days_ahead,
      perDayLimit: 24,
    });
  }, [ctx]);

  const availableDays = useMemo(
    () => Array.from(slotsByDay.keys()).sort(),
    [slotsByDay]
  );

  const effectiveDayKey =
    chosenDayKey && slotsByDay.has(chosenDayKey)
      ? chosenDayKey
      : (availableDays[0] ?? null);

  const slots: Slot[] = effectiveDayKey
    ? (slotsByDay.get(effectiveDayKey) ?? [])
    : [];

  const openNow = useMemo(() => {
    if (!ctx) return false;
    const hours = normalizeOpeningHours(
      ctx.merchant.opening_hours as Partial<OpeningHours> | null
    );
    return isOpenNow(hours);
  }, [ctx]);

  useEffect(() => {
    if (ctx && !openNow && pickupType === "asap") {
      setPickupType("slot");
    }
  }, [ctx, openNow, pickupType]);

  // Pré-remplissage du mode (retrait/livraison) choisi DÈS la fiche boutique
  // (persisté dans le panier). Appliqué UNE fois, une fois le contexte chargé.
  // La position de livraison reste à confirmer ici (cf. section livraison).
  const modeAppliedRef = useRef(false);
  useEffect(() => {
    if (modeAppliedRef.current || !ctx) return;
    modeAppliedRef.current = true;
    if (cart.mode === "delivery" && ctx.delivery?.enabled) {
      setDelivery((d) => ({
        ...d,
        fulfillment: "delivery",
        mode: ctx.delivery.express_enabled
          ? "express"
          : ctx.delivery.tours_enabled
            ? "tour"
            : null,
      }));
    }
  }, [ctx, cart.mode]);

  // GA4 — begin_checkout, une seule fois quand le contexte (prix recalculés) est
  // prêt et que le panier n'est pas vide. No-op si GA désactivé.
  const beginCheckoutRef = useRef(false);
  useEffect(() => {
    if (beginCheckoutRef.current) return;
    if (!ctx || ctx.error || cart.items.length === 0) return;
    beginCheckoutRef.current = true;
    trackBeginCheckout(
      cart.items.map((i) => ({
        id: i.product_id,
        name: i.name,
        unitPriceDa: i.unit_price_da,
        quantity: i.quantity,
        category: i.category_title ?? null,
      })),
      ctx.cart.totalDa,
      ctx.merchant.name
    );
  }, [ctx, cart.items]);

  if (isRedirecting) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center lg:py-20">
        <Loader2 className="text-primary-600 mx-auto size-6 animate-spin" />
        <p className="text-foreground mt-3 text-base font-semibold">
          {payment === "online"
            ? t("redirectingOnlineTitle")
            : t("redirectingCashTitle")}
        </p>
        <p className="text-muted mt-1 text-xs">
          {payment === "online"
            ? t("redirectingOnlineSub")
            : t("redirectingCashSub")}
        </p>
      </div>
    );
  }

  if (!cart.merchant_id || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center lg:py-20">
        <ShoppingCart className="text-primary-500 mx-auto size-12" />
        <h1 className="text-foreground mt-4 text-2xl font-bold">
          {tc("emptyTitle")}
        </h1>
        <Link
          href="/"
          className="bg-primary-600 hover:bg-primary-700 mt-6 inline-flex rounded-[10px] px-4 py-2 text-sm font-medium text-white"
        >
          {tc("seeMerchants")}
        </Link>
      </div>
    );
  }

  if (loading || !ctx) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center lg:py-20">
        <Loader2 className="text-primary-600 mx-auto size-6 animate-spin" />
        <p className="text-muted mt-3 text-sm">{t("preparing")}</p>
      </div>
    );
  }

  if (ctx.error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <div className="border-danger-200 bg-danger-50 text-danger-800 rounded-[14px] border p-4 text-sm">
          {ctx.error}
        </div>
        <Link
          href="/cart"
          className="text-primary-700 mt-4 inline-flex text-sm font-medium hover:underline"
        >
          {t("backToCart")}
        </Link>
      </div>
    );
  }

  function submit() {
    if (pickupType === "slot" && chosenSlotIdx == null) {
      toast.error(t("errPickupSlot"));
      return;
    }
    if (delivery.fulfillment === "delivery") {
      const hasSavedAddress = !!delivery.addressId;
      const hasConfirmedCustom =
        !!delivery.customPosition && delivery.positionConfirmed;
      if (!hasSavedAddress && !hasConfirmedCustom) {
        toast.error(t("errConfirmPosition"));
        return;
      }
      if (!delivery.mode) {
        toast.error(t("errChooseMode"));
        return;
      }
      if (delivery.mode === "tour" && !delivery.slotId) {
        toast.error(t("errTourSlot"));
        return;
      }
      const phoneForDelivery = (
        delivery.phoneOverride.trim() ||
        customer.phone ||
        ""
      ).trim();
      if (phoneForDelivery === "") {
        toast.error(t("errPhoneRequired"));
        return;
      }
    }
    const slot = pickupType === "slot" ? slots[chosenSlotIdx!] : null;
    const clientOpId = crypto.randomUUID();

    startSubmit(async () => {
      // Devis signé (Partie D) lié à l'adresse de livraison affichée. Émis ici
      // puis vérifié+consommé par createOrder → la commande est liée à l'adresse
      // vue par le client (usage unique). Best-effort, jamais bloquant.
      let deliveryQuoteId: string | null = null;
      if (delivery.fulfillment === "delivery" && delivery.mode) {
        const dLat = delivery.customPosition?.lat ?? selectedDeliveryAddr?.lat;
        const dLng = delivery.customPosition?.lng ?? selectedDeliveryAddr?.lng;
        if (dLat != null && dLng != null) {
          const q = await issueDeliveryQuote({
            lat: dLat,
            lng: dLng,
            address_text:
              delivery.customAddressText?.trim() ||
              selectedDeliveryAddr?.address_text ||
              null,
            fee_da: deliveryFeeDa,
            mode: delivery.mode,
          });
          deliveryQuoteId = q?.quoteId ?? null;
        }
      }
      const res = await createOrder({
        merchant_id: cart.merchant_id!,
        client_operation_id: clientOpId,
        items: cart.items.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          options: i.options?.map((o) => ({ option_id: o.option_id })),
        })),
        pickup_type: pickupType,
        pickup_slot_start: slot?.start.toISOString() ?? null,
        pickup_slot_end: slot?.end.toISOString() ?? null,
        payment_method: payment,
        customer_note: note.trim() || null,
        fulfillment_type: delivery.fulfillment,
        delivery_mode:
          delivery.fulfillment === "delivery" ? delivery.mode : null,
        delivery_address_id:
          delivery.fulfillment === "delivery" ? delivery.addressId : null,
        delivery_slot_id:
          delivery.fulfillment === "delivery" && delivery.mode === "tour"
            ? delivery.slotId
            : null,
        delivery_phone_override:
          delivery.fulfillment === "delivery"
            ? delivery.phoneOverride.trim() || null
            : null,
        delivery_recipient_name:
          delivery.fulfillment === "delivery"
            ? delivery.recipientName.trim() || null
            : null,
        delivery_custom_lat:
          delivery.fulfillment === "delivery" && delivery.customPosition
            ? delivery.customPosition.lat
            : null,
        delivery_custom_lng:
          delivery.fulfillment === "delivery" && delivery.customPosition
            ? delivery.customPosition.lng
            : null,
        delivery_custom_address_text:
          delivery.fulfillment === "delivery" && delivery.customPosition
            ? delivery.customAddressText?.trim() || null
            : null,
        delivery_note:
          delivery.fulfillment === "delivery"
            ? delivery.deliveryNote.trim() || null
            : null,
        delivery_quote_id: deliveryQuoteId,
        cashback_to_use_da: useCashback && cashbackOn ? cashbackApplied : 0,
        topup_to_use_da: useTopup && coligoPayOn ? topupApplied : 0,
        promo_code: appliedPromo?.code ?? null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (payment === "online" && res.checkout_url) {
        setIsRedirecting(true);
        window.location.href = res.checkout_url;
        return;
      }
      setIsRedirecting(true);
      clearCart();
      router.push(`/commandes/${res.order_id}`);
    });
  }

  function applyPromo() {
    const code = promoInput.trim();
    if (!code || !cart.merchant_id) return;
    setPromoError(null);
    startPromoCheck(async () => {
      const res = await previewPromoCode({
        merchant_id: cart.merchant_id!,
        items: cart.items.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          options: i.options?.map((o) => ({ option_id: o.option_id })),
        })),
        code,
      });
      if (res.ok) {
        setAppliedPromo({ code: res.code, discount_da: res.discount_da });
        setPromoInput(res.code);
        setPromoError(null);
      } else {
        setAppliedPromo(null);
        setPromoError(res.error);
      }
    });
  }

  function clearPromo() {
    setAppliedPromo(null);
    setPromoInput("");
    setPromoError(null);
  }

  // ── Calculs (recalculés côté serveur — source de vérité) ──
  const selectedDeliveryAddr =
    delivery.fulfillment === "delivery"
      ? (ctx.delivery.addresses.find((a) => a.id === delivery.addressId) ??
        null)
      : null;

  // Frais d'une position custom (GPS « Ma position actuelle » / carte / lieu) —
  // MÊME calcul que le serveur (createOrder) : barème express à la distance, ou
  // prix de bande en tournée. Sans ça, le récap affichait 0 pour une position
  // custom (alors que le serveur facture bien le frais). Calcul direct (pas de
  // useMemo : on est APRÈS les early-returns, donc pas un hook).
  const customDeliveryQuote = (() => {
    if (delivery.fulfillment !== "delivery" || !delivery.customPosition) {
      return null;
    }
    const mp = ctx.delivery.merchantPosition;
    const pr = ctx.delivery.pricing;
    if (!mp || !pr) return null;
    const distKm = haversineKm(
      { lat: mp.lat, lng: mp.lng },
      delivery.customPosition
    );
    return delivery.mode === "tour"
      ? computeTourDeliveryFee(distKm, ctx.delivery.tour_bands, pr, mp.radiusKm)
      : computeDeliveryFee(distKm, pr, mp.radiusKm);
  })();

  const deliveryFeeDa =
    selectedDeliveryAddr && !selectedDeliveryAddr.out_of_range
      ? delivery.mode === "tour"
        ? (selectedDeliveryAddr.tour_fee_da ?? selectedDeliveryAddr.fee_da ?? 0)
        : (selectedDeliveryAddr.fee_da ?? 0)
      : customDeliveryQuote && !customDeliveryQuote.outOfRange
        ? customDeliveryQuote.feeDa
        : 0;

  const hasValidDeliveryPosition =
    (selectedDeliveryAddr != null && !selectedDeliveryAddr.out_of_range) ||
    (delivery.customPosition != null && delivery.positionConfirmed);
  const deliveryPhone = (
    delivery.phoneOverride.trim() ||
    customer.phone ||
    ""
  ).trim();
  const isDelivery = delivery.fulfillment === "delivery";
  // Livraison à un tiers : nom + téléphone du destinataire obligatoires.
  const recipientName = delivery.recipientName.trim();
  const recipientReady =
    recipientName === "" || delivery.phoneOverride.trim() !== "";
  const deliveryReady =
    !isDelivery ||
    (hasValidDeliveryPosition &&
      delivery.mode != null &&
      (delivery.mode !== "tour" || !!delivery.slotId) &&
      deliveryPhone !== "" &&
      recipientReady);

  // Une ligne au poids/volume compte pour 1 article (pas de « 2,75 articles »).
  const totalUnits = ctx.lines.reduce(
    (s, l) => s + (Number.isInteger(l.quantity) ? l.quantity : 1),
    0
  );

  const totalBeforeWallets =
    ctx.cart.totalDa + ctx.service_fee_da + deliveryFeeDa;
  // Le code promo (estimation client) retranche du total avant soldes ; le
  // serveur recalcule et tranche à la création.
  const promoDiscount = appliedPromo
    ? Math.min(appliedPromo.discount_da, totalBeforeWallets)
    : 0;
  const totalAfterPromo = Math.max(0, totalBeforeWallets - promoDiscount);
  const cashbackApplied = useCashback
    ? Math.min(ctx.cashback_balance_da, totalAfterPromo)
    : 0;
  const totalAfterCashback = Math.max(0, totalAfterPromo - cashbackApplied);
  const topupApplied = useTopup
    ? Math.min(ctx.topup_balance_da, totalAfterCashback)
    : 0;
  const totalAfterWallets = Math.max(0, totalAfterCashback - topupApplied);

  // Cashback GAGNÉ selon le mode de paiement — taux réels (marchand ??
  // plateforme), même assiette que le trigger 0118 : panier produits NET,
  // jamais les frais. En espèces, le plafond COD « moitié du panier »
  // s'applique aussi (estimation prudente, le trigger reste juge).
  const cashbackEarnOnline = Math.round(
    ctx.cart.totalDa * ctx.cashback_rate_online
  );
  const cashbackEarnCash = Math.min(
    Math.round(ctx.cart.totalDa * ctx.cashback_rate_cash),
    Math.floor(ctx.cart.totalDa / 2)
  );
  const cashbackEarnSelected =
    payment === "online" ? cashbackEarnOnline : cashbackEarnCash;
  // Gain SUPPLÉMENTAIRE si le client passait en ligne (bannière comparative).
  const onlineCashbackExtra = cashbackEarnOnline - cashbackEarnCash;

  const walletUsed = cashbackApplied > 0 || topupApplied > 0;
  // Cas « soldes couvrent tout » : 0 DA à régler en ligne → autorisé (le
  // serveur marque payé). On rassure le client au lieu de bloquer.
  const onlineFullyCovered =
    payment === "online" && walletUsed && totalAfterWallets === 0;
  // Sinon, le reste en ligne doit atteindre le minimum Chargily.
  const onlineTooLow =
    payment === "online" &&
    totalAfterWallets > 0 &&
    totalAfterWallets < CHARGILY_MIN_AMOUNT_DA;
  const slotMissing = pickupType === "slot" && chosenSlotIdx == null;
  const canSubmit =
    !submitting && deliveryReady && !slotMissing && !onlineTooLow;

  const totalLabel =
    payment === "cash"
      ? isDelivery
        ? t("toPayCashDelivery")
        : t("toPayCashPickup")
      : t("paidOnline");

  const resteLabel =
    payment === "cash" ? t("remainingCash") : t("remainingOnline");
  const barLabel =
    totalAfterWallets === 0 && walletUsed ? t("paidWithBalances") : totalLabel;

  // Message d'aide sous le bouton (livraison incomplète).
  const blockReason =
    isDelivery && !deliveryReady
      ? !hasValidDeliveryPosition
        ? t("blockConfirmPosition")
        : !delivery.mode
          ? t("blockChooseMode")
          : delivery.mode === "tour" && !delivery.slotId
            ? t("errTourSlot")
            : deliveryPhone === ""
              ? t("blockPhone")
              : ""
      : slotMissing
        ? t("errPickupSlot")
        : "";

  // Jauge « frais offerts » : progression vers le palier de gratuité.
  const gaugePct =
    ctx.service_fee_free_in_da != null && ctx.service_fee_free_in_da > 0
      ? Math.max(
          8,
          Math.min(
            92,
            Math.round(
              (ctx.cart.totalDa /
                (ctx.cart.totalDa + ctx.service_fee_free_in_da)) *
                100
            )
          )
        )
      : 100;

  const toggleWallet = (which: "cashback" | "topup") => {
    if (which === "cashback") setUseCashback((v) => !v);
    else setUseTopup((v) => !v);
    setWalletBump((n) => n + 1);
  };

  return (
    <div data-checkout>
      <div className="mx-auto max-w-[560px] px-4 pt-3 pb-44">
        {showConflict && (
          <CartConflictModal
            current={cart}
            others={otherCarts}
            onResolved={() => setConflictDismissed(true)}
          />
        )}

        {/* En-tête : flèche retour + titre. */}
        <div className="flex items-center gap-3 pt-1 pb-2">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label={t("backToCart")}
            className="bg-surface-2 text-foreground grid size-9 shrink-0 place-items-center rounded-full transition active:scale-90"
          >
            <ArrowLeft className="size-[18px]" />
          </button>
          <h1 className="text-foreground text-[20px] font-extrabold tracking-tight">
            {t("title")}
          </h1>
        </div>

        {/* Bloc boutique — logo dégradé sombre + eyebrow violet. */}
        <Block delay={0.02}>
          <div className="flex items-center gap-3 p-4">
            <span className="grid size-[46px] shrink-0 place-items-center rounded-[13px] bg-gradient-to-br from-[#26262e] to-[#0b0b0f] text-white shadow-[0_6px_14px_-4px_rgba(0,0,0,0.4)]">
              <Store className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-primary-600 text-[10px] font-extrabold tracking-wider uppercase">
                {t("myOrder")}
              </p>
              <p className="text-foreground truncate text-[16px] font-extrabold">
                {ctx.merchant.name}
              </p>
              <p className="text-muted text-[12px] font-semibold">
                {t("itemsInCart", { count: totalUnits })}
              </p>
            </div>
            <Link
              href="/cart"
              className="text-primary-700 shrink-0 text-[13px] font-extrabold transition active:scale-90"
            >
              {t("edit")}
            </Link>
          </div>
        </Block>

        {/* Toggle Retrait / Livraison + détail livraison (carte, statut, repli). */}
        <CheckoutDeliverySection
          delivery={ctx.delivery}
          merchantPosition={ctx.delivery.merchantPosition}
          pricing={ctx.delivery.pricing}
          value={delivery}
          onChange={setDelivery}
          defaultPosition={savedPosition}
        />

        {/* Créneau de retrait (uniquement si retrait) */}
        {!isDelivery && (
          <Block className="mt-3" delay={0.07}>
            <div className="text-muted flex items-center gap-2 px-4 pt-4 pb-3 text-[13px] font-bold">
              <Store className="text-primary-600 size-4 shrink-0" />
              {t("pickupAt", { name: ctx.merchant.name })}
            </div>

            {!openNow && (
              <div className="border-warning-100 bg-warning-50 text-warning-800 mx-4 mb-3 rounded-[10px] border px-3 py-2 text-xs">
                {t("closedPickSlot")}
              </div>
            )}

            <div className="divide-border border-border divide-y border-t">
              <SlotRadio
                checked={pickupType === "asap"}
                onClick={() => setPickupType("asap")}
                icon={<Clock className="size-[17px]" />}
                title={t("immediatePrep")}
                hint={formatAsapReady(
                  new Date(Date.now() + ctx.merchant.prep_time_min * 60_000)
                )}
                disabled={!openNow}
              />
              <SlotRadio
                checked={pickupType === "slot"}
                onClick={() => setPickupType("slot")}
                icon={<CalendarGlyph />}
                title={t("chooseSlot")}
                hint={
                  availableDays.length === 0
                    ? t("noSlotAvailable")
                    : t("upToDaysAhead", { days: ctx.merchant.max_days_ahead })
                }
                disabled={availableDays.length === 0}
              />
            </div>

            {pickupType === "slot" && availableDays.length > 0 && (
              <div className="space-y-2 px-4 pt-3 pb-4">
                <div className="scrollbar-hide -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                  {availableDays.map((dayKey) => {
                    const sample = slotsByDay.get(dayKey)?.[0]?.start;
                    if (!sample) return null;
                    const label = formatDayRelative(sample);
                    const active = effectiveDayKey === dayKey;
                    return (
                      <button
                        key={dayKey}
                        type="button"
                        onClick={() => {
                          setChosenDayKey(dayKey);
                          setChosenSlotIdx(null);
                        }}
                        className={cn(
                          "shrink-0 rounded-[10px] border px-3 py-1.5 text-xs font-bold capitalize transition",
                          active
                            ? "border-primary-600 bg-primary-50 text-primary-700"
                            : "border-border bg-surface hover:border-primary-300"
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {slots.map((s, i) => (
                    <button
                      key={s.start.toISOString()}
                      type="button"
                      onClick={() => setChosenSlotIdx(i)}
                      className={cn(
                        "rounded-[10px] border px-3 py-1.5 text-sm font-bold tabular-nums transition",
                        chosenSlotIdx === i
                          ? "border-primary-600 bg-primary-600 text-white"
                          : "border-border bg-surface hover:border-primary-300"
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Block>
        )}

        {/* Paiement — DEUX cartes côte à côte + badge cashback comparatif. */}
        <Block className="mt-3" delay={0.12}>
          <SectionTitle icon={CreditCard} className="px-4 pt-4">
            {t("payment")}
          </SectionTitle>
          <div
            className={`grid gap-2.5 px-4 pt-3 pb-4 ${onlineVisible ? "grid-cols-2" : "grid-cols-1"}`}
          >
            <PayCard
              icon={Banknote}
              selected={payment === "cash"}
              onClick={() => setPayment("cash")}
              title={isDelivery ? t("cashOnDelivery") : t("cashOnPickup")}
              sub={isDelivery ? t("cashDeliverySub") : t("cashPickupSub")}
              disabled={!ctx.merchant.accepts_cash}
              chip={
                cashbackOn && cashbackEarnCash > 0
                  ? t("cashbackChip", { amount: formatDA(cashbackEarnCash) })
                  : t("noCashbackChip")
              }
              chipTone={
                cashbackOn && cashbackEarnCash > 0 ? "success" : "muted"
              }
            />
            {onlineVisible && (
              <PayCard
                icon={CreditCard}
                selected={payment === "online"}
                onClick={() => onlineUsable && setPayment("online")}
                title={t("online")}
                bolt
                sub={onlineUsable ? t("onlineSub") : "Bientôt"}
                disabled={!ctx.merchant.accepts_online || !onlineUsable}
                chip={
                  cashbackOn && cashbackEarnOnline > 0
                    ? t("cashbackChip", {
                        amount: formatDA(cashbackEarnOnline),
                      })
                    : t("noCashbackChip")
                }
                chipTone={
                  cashbackOn && cashbackEarnOnline > 0 ? "success" : "muted"
                }
              />
            )}
          </div>

          {/* Comparatif : en espèces, montre le gain MANQUÉ → tap = bascule. */}
          {payment === "cash" &&
            ctx.merchant.accepts_online &&
            onlineUsable &&
            cashbackOn &&
            onlineCashbackExtra > 0 && (
              <button
                type="button"
                onClick={() => setPayment("online")}
                className="bg-primary-50 mx-4 mb-4 flex w-[calc(100%-2rem)] items-center gap-2.5 rounded-[13px] px-3.5 py-3 text-start transition active:scale-[0.99]"
              >
                <span className="text-primary-600 grid size-8 shrink-0 place-items-center rounded-[9px] bg-white shadow-[0_3px_8px_-2px_rgba(91,91,230,0.4)]">
                  <Gift className="size-4" />
                </span>
                <span className="text-primary-800 flex-1 text-[12.5px] leading-snug font-bold">
                  {t.rich("cashbackOnlineExtra", {
                    amount: formatDA(onlineCashbackExtra),
                    strong: (chunks) => (
                      <strong className="font-extrabold">{chunks}</strong>
                    ),
                  })}
                </span>
                <ChevronRight className="text-primary-600 size-4 shrink-0 rtl:rotate-180" />
              </button>
            )}

          {/* Soldes — DEUX switches séparés, cumulables (si solde > 0).
              Masqués si la fonctionnalité correspondante est coupée (super-admin). */}
          {((coligoPayOn && ctx.topup_balance_da > 0) ||
            (cashbackOn && ctx.cashback_balance_da > 0)) && (
            <div className="divide-border border-border divide-y border-t">
              {coligoPayOn && ctx.topup_balance_da > 0 && (
                <WalletRow
                  icon={Wallet}
                  title="Coligo Pay"
                  sub={t("balanceAmount", {
                    amount: formatDA(ctx.topup_balance_da),
                  })}
                  checked={useTopup}
                  onToggle={() => toggleWallet("topup")}
                />
              )}
              {cashbackOn && ctx.cashback_balance_da > 0 && (
                <WalletRow
                  icon={Gift}
                  title={t("myCashback")}
                  sub={t("availableAmount", {
                    amount: formatDA(ctx.cashback_balance_da),
                  })}
                  checked={useCashback}
                  onToggle={() => toggleWallet("cashback")}
                />
              )}
            </div>
          )}

          {onlineTooLow && (
            <div className="border-danger-200 bg-danger-50 text-danger-800 mx-4 mt-3 mb-1 rounded-[10px] border px-3 py-2 text-xs">
              {t.rich("onlineTooLow", {
                min: formatDA(CHARGILY_MIN_AMOUNT_DA),
                remaining: formatDA(totalAfterWallets),
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </div>
          )}
          {onlineFullyCovered && (
            <div className="border-success-200 bg-success-50 text-success-800 mx-4 mt-3 mb-1 flex items-center gap-2 rounded-[10px] border px-3 py-2 text-xs">
              <Check className="size-4 shrink-0" />
              <span>
                {t.rich("onlineFullyCovered", {
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
              </span>
            </div>
          )}
        </Block>

        {/* Promo + Note = lignes repliables compactes. */}
        <Block className="mt-3" delay={0.17}>
          {appliedPromo ? (
            <div className="flex items-center gap-3 p-4">
              <span className="bg-success-50 text-success-700 grid size-[34px] shrink-0 place-items-center rounded-[10px]">
                <Tag className="size-[17px]" />
              </span>
              <span className="text-success-800 flex-1 text-sm font-extrabold">
                {t("promoApplied", {
                  code: appliedPromo.code,
                  discount: formatDA(appliedPromo.discount_da),
                })}
              </span>
              <button
                type="button"
                onClick={clearPromo}
                className="text-muted hover:text-foreground grid size-7 shrink-0 place-items-center rounded-full transition"
                aria-label={t("removePromo")}
              >
                <X className="size-4" />
              </button>
            </div>
          ) : promoOpen ? (
            <div className="p-4">
              <div className="flex gap-2">
                <input
                  value={promoInput}
                  autoFocus
                  onChange={(e) => {
                    setPromoInput(e.target.value.toUpperCase());
                    if (promoError) setPromoError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyPromo();
                    }
                  }}
                  placeholder={t("promoPlaceholder")}
                  className="border-border bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 w-full rounded-[12px] border px-3 py-2.5 text-sm uppercase focus-visible:ring-2 focus-visible:outline-none"
                />
                <button
                  type="button"
                  onClick={applyPromo}
                  disabled={promoChecking || promoInput.trim() === ""}
                  className="bg-foreground text-background shrink-0 rounded-[12px] px-4 text-sm font-extrabold transition disabled:opacity-40"
                >
                  {promoChecking ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    t("apply")
                  )}
                </button>
              </div>
              {promoError && (
                <p className="text-danger-600 mt-2 text-xs font-semibold">
                  {promoError}
                </p>
              )}
            </div>
          ) : (
            <AddLine
              icon={<Tag className="size-[17px]" />}
              title={t("addPromoCode")}
              onClick={() => setPromoOpen(true)}
            />
          )}

          <div className="border-border border-t">
            {noteOpen || note.trim() !== "" ? (
              <div className="p-4">
                <p className="text-muted mb-2 flex items-center gap-2 text-[11px] font-extrabold tracking-wider uppercase">
                  <Sparkles className="text-foreground size-[14px]" />
                  {t("noteToMerchant")}
                </p>
                <textarea
                  value={note}
                  autoFocus={noteOpen && note === ""}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={300}
                  placeholder={t("notePlaceholder")}
                  className="border-border bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 w-full resize-none rounded-[12px] border px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
                />
              </div>
            ) : (
              <AddLine
                icon={<Sparkles className="size-[17px]" />}
                title={t("noteToMerchant")}
                sub={t("noteHint")}
                onClick={() => setNoteOpen(true)}
              />
            )}
          </div>
        </Block>

        {/* Récap dense */}
        <Block className="mt-3" delay={0.22}>
          <div className="p-4">
            <SectionTitle icon={Receipt} className="mb-3">
              {t("recap")}
            </SectionTitle>
            {ctx.service_fee_da > 0 && ctx.service_fee_free_in_da != null && (
              <div className="bg-primary-50 text-primary-700 relative mb-3.5 flex items-center gap-2.5 overflow-hidden rounded-[13px] px-3.5 py-3 text-[12.5px] font-bold">
                <span className="text-primary-600 grid size-7 shrink-0 place-items-center rounded-[8px] bg-white shadow-[0_2px_6px_-1px_rgba(91,91,230,0.4)]">
                  <Zap className="size-3.5" />
                </span>
                <span>
                  {t.rich("serviceFeeFreeIn", {
                    amount: formatDA(ctx.service_fee_free_in_da),
                    strong: (chunks) => <strong>{chunks}</strong>,
                  })}
                </span>
                <span
                  className="from-primary-600 to-primary-400 absolute bottom-0 left-0 h-[3px] rounded-r-full bg-gradient-to-r"
                  style={{ width: `${gaugePct}%` }}
                />
              </div>
            )}
            <dl className="space-y-1">
              <RRow
                label={t("subtotal")}
                value={formatDA(ctx.cart.normalTotalDa)}
                muted
              />
              {ctx.cart.savingsDa > 0 && (
                <RRow
                  label={t("productPromo")}
                  value={`− ${formatDA(ctx.cart.savingsDa)}`}
                  tone="success"
                />
              )}
              {ctx.service_fee_da > 0 ? (
                <RRow
                  label={t("serviceFee")}
                  value={`+ ${formatDA(ctx.service_fee_da)}`}
                  muted
                />
              ) : (
                ctx.cart.totalDa > 0 && (
                  <RRow
                    label={t("serviceFee")}
                    value={t("free")}
                    tone="success"
                  />
                )
              )}
              {deliveryFeeDa > 0 && (
                <RRow
                  label={t("deliveryFee")}
                  value={formatDA(deliveryFeeDa)}
                />
              )}
              {promoDiscount > 0 && (
                <RRow
                  label={t("promoCodeLabel", {
                    code: appliedPromo?.code ?? "",
                  })}
                  value={`− ${formatDA(promoDiscount)}`}
                  tone="success"
                />
              )}

              {walletUsed ? (
                <>
                  <RRow
                    label={t("orderTotal")}
                    value={formatDA(totalAfterPromo)}
                  />
                  <hr className="border-border my-2 border-dashed" />
                  {cashbackApplied > 0 && (
                    <RRow
                      label={t("cashbackUsed")}
                      value={`− ${formatDA(cashbackApplied)}`}
                      tone="success"
                    />
                  )}
                  {topupApplied > 0 && (
                    <RRow
                      label={t("topupUsed")}
                      value={`− ${formatDA(topupApplied)}`}
                      tone="success"
                    />
                  )}
                  <hr className="border-border my-2 border-dashed" />
                  <TotRow
                    label={resteLabel}
                    value={formatDA(totalAfterWallets)}
                  />
                </>
              ) : (
                <>
                  <hr className="border-border my-2 border-dashed" />
                  <TotRow
                    label={totalLabel}
                    value={formatDA(totalAfterWallets)}
                  />
                </>
              )}
            </dl>

            {ctx.merchant.min_order_da > 0 &&
              ctx.cart.totalDa < ctx.merchant.min_order_da && (
                <p className="text-danger-600 mt-2 text-xs">
                  {t("minOrder", {
                    amount: formatDA(ctx.merchant.min_order_da),
                  })}
                </p>
              )}
          </div>
        </Block>

        {/* Cashback GAGNÉ = gain futur (jamais un frais). Encadré vert séparé.
            Montant RÉEL du mode sélectionné (taux marchand ?? plateforme). */}
        {cashbackOn && cashbackEarnSelected > 0 && ctx.cart.totalDa > 0 && (
          <div className="bg-success-50 co-rise relative mt-3 flex items-center gap-3 overflow-hidden rounded-[16px] p-3.5 shadow-[0_6px_18px_-10px_rgba(21,145,90,0.4)]">
            <span className="text-success-700 z-[2] grid size-9 shrink-0 place-items-center rounded-[11px] bg-white shadow-[0_3px_8px_-2px_rgba(21,145,90,0.35)]">
              <Gift className="size-[18px]" />
            </span>
            <p className="text-success-700 z-[2] text-[12.5px] leading-snug font-bold">
              {t.rich("cashbackEarn", {
                amount: formatDA(cashbackEarnSelected),
                strong: (chunks) => (
                  <strong className="font-extrabold">{chunks}</strong>
                ),
              })}
            </p>
            <span className="absolute -top-5 -right-5 size-20 rounded-full bg-[rgba(21,145,90,0.06)]" />
          </div>
        )}
      </div>

      {/* ── Barre d'action UNIQUE, fixe en bas ── */}
      <div className="border-border fixed inset-x-0 bottom-16 z-40 border-t bg-white/95 px-4 pt-3 pb-3 shadow-[0_-8px_30px_rgba(40,35,90,0.1)] backdrop-blur-md lg:bottom-0">
        <div className="mx-auto max-w-[560px]">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <span className="text-muted text-[12.5px] font-semibold">
              {barLabel}
            </span>
            <span
              key={walletBump}
              className="text-foreground co-bump text-[23px] font-extrabold tracking-tight tabular-nums"
            >
              {formatDA(totalAfterWallets)}
            </span>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              "relative inline-flex h-[54px] w-full items-center justify-center gap-2 overflow-hidden rounded-[16px] text-base font-extrabold transition-all",
              canSubmit
                ? "from-primary-400 to-primary-700 co-shine bg-gradient-to-br text-white shadow-[0_10px_26px_-8px_rgba(91,91,230,0.55)] active:scale-[0.98]"
                : "bg-foreground/90 cursor-not-allowed text-white opacity-50"
            )}
          >
            {submitting ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <span className="relative z-[2] flex items-center justify-center gap-2">
                {t("confirmOrder")}
                <ChevronRight className="size-[18px]" />
              </span>
            )}
          </button>
          {blockReason && (
            <p className="text-warning-700 mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] font-bold">
              <AlertTriangle className="size-3.5" />
              {blockReason}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sous-composants visuels (style Uber, accent violet Coligo) ──

/** Bloc premium : ombre douce multi-couche + entrée en cascade (co-rise). */
function Block({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <section
      className={cn(
        "bg-surface co-rise overflow-hidden rounded-[20px] shadow-[0_1px_2px_rgba(20,20,50,0.04),0_6px_20px_-10px_rgba(40,35,90,0.16)]",
        className
      )}
      style={{ animationDelay: `${delay}s` }}
    >
      {children}
    </section>
  );
}

function SectionTitle({
  icon: Icon,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "text-muted flex items-center gap-2 text-[11px] font-extrabold tracking-wider uppercase",
        className
      )}
    >
      <Icon className="text-foreground size-[14px]" />
      {children}
    </h2>
  );
}

/**
 * Option de paiement — CARTE sélectionnable (grille 2 colonnes) avec badge
 * cashback comparatif : le client voit d'un coup d'œil ce que chaque mode
 * lui rapporte (vert = gain, neutre = pas de cashback).
 */
function PayCard({
  icon: Icon,
  selected,
  onClick,
  title,
  sub,
  chip,
  chipTone,
  bolt,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  selected: boolean;
  onClick: () => void;
  title: string;
  sub: string;
  chip: string;
  chipTone: "success" | "muted";
  bolt?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "relative flex flex-col items-start gap-2.5 rounded-[16px] border-2 p-3.5 pt-4 text-start transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45",
        selected
          ? "border-primary-600 bg-primary-50 shadow-[0_10px_24px_-10px_rgba(108,43,217,0.45)]"
          : "border-border bg-surface hover:border-primary-300"
      )}
    >
      {/* Coche de sélection (coin) */}
      <span
        className={cn(
          "absolute end-2.5 top-2.5 grid size-[20px] place-items-center rounded-full transition",
          selected
            ? "bg-primary-600 co-pop text-white"
            : "border-border-strong border-2 bg-white"
        )}
      >
        {selected && <Check className="size-3" strokeWidth={3.5} />}
      </span>

      <span
        className={cn(
          "grid size-[38px] shrink-0 place-items-center rounded-[11px]",
          selected
            ? "text-primary-600 bg-white shadow-[0_3px_8px_-2px_rgba(91,91,230,0.4)]"
            : "bg-surface-2 text-foreground"
        )}
      >
        <Icon className="size-[18px]" />
      </span>

      <span className="min-w-0">
        <span className="text-foreground flex items-center gap-1.5 text-[13.5px] leading-tight font-extrabold">
          {title}
          {bolt && (
            <span className="grid size-[17px] shrink-0 place-items-center rounded-[6px] bg-gradient-to-br from-[#ffb02e] to-[#c77a18] text-white shadow-[0_2px_5px_rgba(199,122,24,0.4)]">
              <Zap className="size-[10px]" fill="currentColor" />
            </span>
          )}
        </span>
        <span className="text-muted mt-1 block text-[11px] leading-snug font-semibold">
          {sub}
        </span>
      </span>

      {/* Badge cashback — l'argument de comparaison entre les deux modes. */}
      <span
        className={cn(
          "mt-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold tabular-nums",
          chipTone === "success"
            ? "bg-success-50 text-success-700"
            : "bg-surface-2 text-subtle"
        )}
      >
        <Gift className="size-3 shrink-0" />
        {chip}
      </span>
    </button>
  );
}

/** Ligne de solde (cashback / Coligo Pay) — switch dans la carte paiement. */
function WalletRow({
  icon: Icon,
  checked,
  onToggle,
  title,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  checked: boolean;
  onToggle: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-start transition active:scale-[0.99]"
    >
      <span className="text-primary-600 bg-surface-2 grid size-[38px] shrink-0 place-items-center rounded-[11px]">
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block text-[14.5px] font-extrabold">
          {title}
        </span>
        <span className="text-muted block text-[11.5px] font-semibold">
          {sub}
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-[27px] w-[46px] shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-primary-600" : "bg-border-strong"
        )}
      >
        <span
          className={cn(
            "inline-block size-[21px] transform rounded-full bg-white shadow transition-transform",
            // RTL : le curseur démarre du bord DROIT → on inverse la translation.
            checked
              ? "translate-x-[22px] rtl:-translate-x-[22px]"
              : "translate-x-[3px] rtl:-translate-x-[3px]"
          )}
        />
      </span>
    </button>
  );
}

/** Ligne repliable compacte (« Ajouter un code promo › »). */
function AddLine({
  icon,
  title,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 p-4 text-start transition active:scale-[0.99]"
    >
      <span className="bg-primary-50 text-primary-600 grid size-[34px] shrink-0 place-items-center rounded-[10px]">
        {icon}
      </span>
      <span className="text-foreground flex-1 text-sm font-bold">
        {title}
        {sub && (
          <span className="text-muted mt-0.5 block text-[11.5px] font-semibold">
            {sub}
          </span>
        )}
      </span>
      <ChevronRight className="text-subtle size-4 shrink-0" />
    </button>
  );
}

/** Créneau de retrait (radio) — ligne dans la carte retrait. */
function SlotRadio({
  checked,
  onClick,
  icon,
  title,
  hint,
  disabled,
}: {
  checked: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3.5 text-start transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50",
        checked && "bg-primary-50"
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-[11px]",
          checked
            ? "text-primary-600 bg-white shadow-[0_3px_8px_-2px_rgba(91,91,230,0.4)]"
            : "bg-surface-2 text-foreground"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block text-[14.5px] font-extrabold">
          {title}
        </span>
        {hint && (
          <span className="text-muted block text-[11.5px] font-semibold">
            {hint}
          </span>
        )}
      </span>
      <span
        className={cn(
          "relative grid size-[21px] shrink-0 place-items-center rounded-full border-2",
          checked ? "border-primary-600" : "border-border-strong"
        )}
      >
        {checked && (
          <span className="bg-primary-600 co-pop size-[11px] rounded-full" />
        )}
      </span>
    </button>
  );
}

/** Petit glyphe calendrier (line icon) pour le créneau programmé. */
function CalendarGlyph() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 9h16M9 3v4M15 3v4" />
    </svg>
  );
}

/** Ligne total en gras (récap). */
function TotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between pt-0.5">
      <dt className="text-foreground text-[17px] font-extrabold">{label}</dt>
      <dd className="text-foreground text-[17px] font-extrabold tabular-nums">
        {value}
      </dd>
    </div>
  );
}

function RRow({
  label,
  value,
  tone,
  muted,
}: {
  label: string;
  value: string;
  tone?: "success" | "primary";
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-[3px] text-sm">
      <dt className={muted ? "text-muted" : "text-foreground font-semibold"}>
        {label}
      </dt>
      <dd
        className={cn(
          "font-semibold tabular-nums",
          tone === "success"
            ? "text-success-700 font-extrabold"
            : tone === "primary"
              ? "text-primary-700"
              : muted
                ? "text-foreground"
                : "text-foreground"
        )}
      >
        {value}
      </dd>
    </div>
  );
}
