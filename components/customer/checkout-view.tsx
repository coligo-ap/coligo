"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  ChevronRight,
  Clock,
  CreditCard,
  Gift,
  Globe,
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
import CheckoutLoading from "@/app/(customer)/checkout/loading";
import { clearCart, useCart, useOtherCarts } from "@/lib/customer/cart-store";
import { openCheckout } from "@/lib/payments/open-checkout";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { CartConflictModal } from "@/components/customer/cart-conflict-modal";
import { generateSlotsForRange, type Slot } from "@/lib/customer/pickup-slots";
import {
  formatAsapReady,
  formatDayCardParts,
  formatSlotRange,
  formatTimeFr,
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
  isOrderPaid,
  issueDeliveryQuote,
  previewPromoCode,
} from "@/app/(customer)/checkout/actions";
import { useInappPayment } from "@/lib/payments/use-inapp-payment";
import {
  PaymentResultOverlay,
  type PaymentResultState,
} from "@/components/payments/payment-result-overlay";
import { trackBeginCheckout } from "@/lib/analytics/ecommerce";
import { getDeviceIdAsync } from "@/lib/customer/device-id";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import {
  computeServiceFeeDa,
  daUntilFreeServiceFee,
} from "@/lib/finance/service-fee";
import { CHARGILY_MIN_AMOUNT_DA } from "@/lib/config/payment-limits";
import { joinIntlWaitlist } from "@/app/(customer)/checkout/intl-actions";
import {
  assertSharedCartOrderable,
  attachOrderToSharedCart,
} from "@/app/(customer)/panier-partage/actions";
import {
  IntlPaymentSheet,
  type StripeIntentPayload,
} from "@/components/customer/intl-payment-sheet";
import { IntlApproxTag } from "@/components/customer/intl-approx";
import type { FeatureStatus } from "@/lib/data/feature-flags";
import type { PaymentMethod } from "@/lib/types";
import {
  CheckoutDeliverySection,
  type DeliveryChoice,
} from "./checkout-delivery-section";
import {
  AddLine,
  Block,
  CalendarGlyph,
  PayCard,
  PickupTile,
  RRow,
  SectionTitle,
  TotRow,
  WalletCard,
} from "./checkout-ui";

type Props = {
  customer: {
    full_name: string;
    phone: string;
    latitude?: number | null;
    longitude?: number | null;
  };
  /** Disponibilité (super-admin) — gèle/masque paiement en ligne, Coligo Pay, cashback. */
  onlinePaymentStatus?: FeatureStatus;
  /** La coupure vise CE compte seulement (mig 0397) → le libellé le dit. */
  onlinePaymentPersonal?: boolean;
  coligoPayStatus?: FeatureStatus;
  cashbackStatus?: FeatureStatus;
  /** Panier PARTAGÉ (?shared=) : la commande créée lui sera liée. */
  sharedCartId?: string | null;
  /** Récupération choisie en INVITANT la famille (mig 0423) — pré-remplit
   *  l'étape livraison : même logique que le checkout normal, zéro ressaisie. */
  sharedDelivery?: {
    fulfillment_type: "pickup" | "delivery";
    delivery_mode: "express" | null;
    delivery_address_id: string | null;
    delivery_address_text: string | null;
    delivery_lat: number | null;
    delivery_lng: number | null;
  } | null;
};

export function CheckoutView({
  customer,
  onlinePaymentStatus = "active",
  onlinePaymentPersonal = false,
  coligoPayStatus = "active",
  cashbackStatus = "active",
  sharedCartId = null,
  sharedDelivery = null,
}: Props) {
  // Raccourcis de disponibilité (super-admin).
  const onlineVisible = onlinePaymentStatus !== "hidden";
  const onlineUsable = onlinePaymentStatus === "active";
  const coligoPayOn = coligoPayStatus === "active";
  const cashbackOn = cashbackStatus === "active";
  const t = useTranslations("checkout");
  const tc = useTranslations("cart");
  const tShared = useTranslations("sharedCart");
  const locale = useLocale();
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
  // Panier partagé : « Faire payer un proche » — commande online SANS ouvrir
  // Chargily ici (defer_payment) ; l'invité paie via /payer/{ptoken}.
  // Rail du paiement en ligne : Chargily (CIB/EDAHABIA, DA) ou Stripe (carte
  // internationale, €). Le taux de change n'apparaît JAMAIS ici — le client
  // voit son total en DA, le montant € s'affiche sur la page Stripe.
  const [onlineRail, setOnlineRail] = useState<"chargily" | "stripe_eur">(
    "chargily"
  );
  // « Me prévenir » (capacité € atteinte) — état local, message inline.
  const [waitlistState, setWaitlistState] = useState<
    "idle" | "pending" | "done"
  >("idle");
  // Paiement € EMBARQUÉ : la feuille s'ouvre sur le retour de createOrder
  // (client_secret + montant €) — aucune redirection hors de l'app.
  const [intlIntent, setIntlIntent] = useState<
    (StripeIntentPayload & { order_id: string }) | null
  >(null);
  // Paiement Chargily DANS l'app (natif) + overlay de résultat premium
  // (traitement → réussi / échoué / annulé / expiré). L'order id payé sert à
  // router vers le suivi de commande.
  const paidOrderRef = useRef<string | null>(null);
  const pay = useInappPayment();
  // Points de pagination du carrousel paiement (affichés seulement si les
  // cartes débordent réellement de l'écran).
  const payScrollRef = useRef<HTMLDivElement>(null);
  const [payDots, setPayDots] = useState<{
    count: number;
    active: number;
  } | null>(null);
  const updatePayDots = () => {
    const el = payScrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 8) {
      setPayDots(null);
      return;
    }
    const count = el.children.length;
    // RTL : scrollLeft négatif → valeur absolue.
    const active = Math.min(
      count - 1,
      Math.round((Math.abs(el.scrollLeft) / max) * (count - 1))
    );
    setPayDots((prev) =>
      prev?.count === count && prev.active === active ? prev : { count, active }
    );
  };
  const [note, setNote] = useState("");
  const [delivery, setDelivery] = useState<DeliveryChoice>(() => {
    const base: DeliveryChoice = {
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
    };
    // Panier partagé : on REPREND le choix fait à l'invitation (adresse
    // enregistrée OU point libre) — le propriétaire retrouve exactement sa
    // sélection, et peut la modifier ici comme dans un checkout normal.
    if (sharedDelivery?.fulfillment_type === "delivery") {
      return {
        ...base,
        fulfillment: "delivery",
        mode: sharedDelivery.delivery_mode ?? "express",
        addressId: sharedDelivery.delivery_address_id,
        customPosition:
          !sharedDelivery.delivery_address_id &&
          sharedDelivery.delivery_lat != null &&
          sharedDelivery.delivery_lng != null
            ? {
                lat: sharedDelivery.delivery_lat,
                lng: sharedDelivery.delivery_lng,
              }
            : null,
        customAddressText: sharedDelivery.delivery_address_id
          ? null
          : sharedDelivery.delivery_address_text,
        positionConfirmed: true,
      };
    }
    return base;
  });
  const [conflictDismissed, setConflictDismissed] = useState(false);
  const showConflict = otherCarts.length > 0 && !conflictDismissed;
  // Erreur de soumission EN LIGNE (sous le bouton) — pas de toast (cf. CLAUDE.md).
  // `note`/`setNote` sont déjà pris par la note client → nom distinct.
  const [submitError, setSubmitError] = useState<string | null>(null);
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
  // Livraison OFFERTE gagnée à la Roue (mig 0421) — AFFICHAGE seulement : le
  // serveur (createOrder) reste seul juge et consomme le crédit. RLS : le
  // client ne lit que SES crédits. Non cumulable avec un code promo.
  const [wheelCredit, setWheelCredit] = useState<{ max_fee_da: number } | null>(
    null
  );
  useEffect(() => {
    const supabase = createBrowserSupabase();
    void (
      supabase.from("customer_delivery_credits" as never) as unknown as {
        select: (c: string) => {
          eq: (
            c: string,
            v: string
          ) => {
            gt: (
              c: string,
              v: string
            ) => {
              limit: (n: number) => {
                maybeSingle: () => Promise<{
                  data: { max_fee_da: number } | null;
                }>;
              };
            };
          };
        };
      }
    )
      .select("max_fee_da")
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setWheelCredit(data);
      });
  }, []);

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

  // Points du carrousel paiement : recalcul quand le contexte (donc le
  // nombre de cartes) change — puis maintenus par onScroll.
  useEffect(() => {
    updatePayDots();
  }, [ctx]);

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

  // Repli Chargily si le rail international disparaît (kill-switch, pays,
  // capacité) pendant que la carte € était sélectionnée.
  useEffect(() => {
    if (
      onlineRail === "stripe_eur" &&
      ctx != null &&
      !ctx.intl_payment.available
    ) {
      setOnlineRail("chargily");
    }
  }, [ctx, onlineRail]);

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

  // PRÉ-SÉLECTION du premier créneau dispo (mode « Planifier » / changement de
  // jour) : moins de friction — la ligne verte de confirmation rend le choix
  // explicite, et le client peut en toucher un autre.
  useEffect(() => {
    if (pickupType === "slot" && chosenSlotIdx == null && slots.length > 0) {
      setChosenSlotIdx(0);
    }
  }, [pickupType, chosenSlotIdx, slots.length]);

  // Jour actif recentré dans sa rangée ; rangée d'heures remise au début à
  // chaque changement de jour ; heure choisie recentrée dans sa rangée.
  const activeDayRef = useRef<HTMLButtonElement | null>(null);
  const activeHourRef = useRef<HTMLButtonElement | null>(null);
  const hoursGridRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeDayRef.current?.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: "smooth",
    });
    if (hoursGridRef.current) hoursGridRef.current.scrollLeft = 0;
  }, [effectiveDayKey]);
  useEffect(() => {
    activeHourRef.current?.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: "smooth",
    });
  }, [chosenSlotIdx]);

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
          className="bg-primary-600 hover:bg-primary-700 rounded-control mt-6 inline-flex px-4 py-2 text-sm font-medium text-white"
        >
          {tc("seeMerchants")}
        </Link>
      </div>
    );
  }

  if (loading || !ctx) {
    // MÊME squelette que la frontière loading.tsx du segment (source unique) :
    // structure visible en continu, pas de spinner nu entre les deux phases.
    return <CheckoutLoading />;
  }

  if (ctx.error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <div className="border-danger-200 bg-danger-50 text-danger-800 rounded-card-lg border p-4 text-sm">
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
    // Filet défensif : le bouton est déjà désactivé (canSubmit) et `blockReason`
    // affiche la raison sous le bouton. Si on arrive ici, on double l'info EN
    // LIGNE plutôt qu'en toast.
    setSubmitError(null);
    if (pickupType === "slot" && chosenSlotIdx == null) {
      setSubmitError(t("errPickupSlot"));
      return;
    }
    if (delivery.fulfillment === "delivery") {
      const hasSavedAddress = !!delivery.addressId;
      const hasConfirmedCustom =
        !!delivery.customPosition && delivery.positionConfirmed;
      if (!hasSavedAddress && !hasConfirmedCustom) {
        setSubmitError(t("errConfirmPosition"));
        return;
      }
      if (!delivery.mode) {
        setSubmitError(t("errChooseMode"));
        return;
      }
      if (delivery.mode === "tour" && !delivery.slotId) {
        setSubmitError(t("errTourSlot"));
        return;
      }
      const phoneForDelivery = (
        delivery.phoneOverride.trim() ||
        customer.phone ||
        ""
      ).trim();
      if (phoneForDelivery === "") {
        setSubmitError(t("errPhoneRequired"));
        return;
      }
    }
    const slot = pickupType === "slot" ? slots[chosenSlotIdx!] : null;
    const clientOpId = crypto.randomUUID();

    startSubmit(async () => {
      // Panier PARTAGÉ : garde ANTI-DOUBLON — un panier déjà commandé ne doit
      // jamais produire une 2ᵉ commande (re-clic « Commander » après abandon).
      if (sharedCartId) {
        const orderable = await assertSharedCartOrderable(sharedCartId);
        if (!orderable.ok) {
          setSubmitError(orderable.error);
          return;
        }
      }
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
        online_rail: payment === "online" ? onlineRail : null,
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
        // Identifiant d'appareil PHYSIQUE (nat:ANDROID_ID en app) d'abord —
        // résiste à la déconnexion ET à la réinstallation, façon Uber.
        device_id: await getDeviceIdAsync(),
      });
      if (!res.ok) {
        setSubmitError(res.error);
        return;
      }
      // Panier PARTAGÉ : lier la commande dès sa création (locked → ordered),
      // quel que soit le mode de paiement — le webhook ne change rien ici.
      // Attendu (pas fire-and-forget) : le lien de paiement invité exige que
      // le panier soit passé `ordered` avant de générer le token.
      if (sharedCartId) {
        await attachOrderToSharedCart(sharedCartId, res.order_id);
      }
      if (payment === "online" && res.stripe_intent) {
        // Rail € : la feuille de paiement embarquée s'ouvre DANS la page —
        // le panier n'est vidé qu'au succès du paiement.
        setIntlIntent({ ...res.stripe_intent, order_id: res.order_id });
        return;
      }
      if (payment === "online" && res.checkout_url) {
        // APK : navigateur intégré + overlay de résultat (l'app reste montée,
        // on sonde le webhook). Web : redirection classique (retour successUrl).
        const orderId = res.order_id;
        const url = res.checkout_url;
        paidOrderRef.current = orderId;
        const opened = await pay.start(
          async () => url,
          async () => isOrderPaid(orderId)
        );
        if (opened === "redirect") setIsRedirecting(true);
        return;
      }
      setIsRedirecting(true);
      clearCart();
      // ?placed=1 : la page commande joue la célébration UNE fois (cash /
      // paiement au retrait — l'online a sa fête sur /checkout/success).
      router.push(`/commandes/${res.order_id}?placed=1`);
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
        device_id: await getDeviceIdAsync(),
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

  const rawDeliveryFeeDa =
    selectedDeliveryAddr && !selectedDeliveryAddr.out_of_range
      ? delivery.mode === "tour"
        ? (selectedDeliveryAddr.tour_fee_da ?? selectedDeliveryAddr.fee_da ?? 0)
        : (selectedDeliveryAddr.fee_da ?? 0)
      : customDeliveryQuote && !customDeliveryQuote.outOfRange
        ? customDeliveryQuote.feeDa
        : 0;

  // Livraison offerte (mig 0331) — TOURNÉE : si le commerçant a une offre
  // free_delivery active et que le sous-total atteint son minimum, la livraison
  // passe à 0 (il l'assume). Miroir exact de la règle serveur (autoritaire).
  // L'EXPRESS n'est jamais concerné.
  const freeDeliveryApplies =
    delivery.fulfillment === "delivery" &&
    delivery.mode === "tour" &&
    ctx.delivery.free_delivery != null &&
    ctx.cart.subtotalDa >= ctx.delivery.free_delivery.min_subtotal_da;
  const deliveryFeeDa = freeDeliveryApplies ? 0 : rawDeliveryFeeDa;

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

  // Code promo : retranché des PRODUITS d'abord (miroir exact du serveur,
  // qui plafonne la remise au net produits). Les FRAIS DE SERVICE se
  // recalculent ensuite sur ce que le client paie RÉELLEMENT — même assiette
  // et mêmes tiers que createOrder, qui reste seul juge (tout est revalidé
  // côté serveur : un montant trafiqué dans le navigateur est ignoré).
  const promoDiscount = appliedPromo
    ? Math.min(appliedPromo.discount_da, ctx.cart.totalDa)
    : 0;
  const goodsAfterPromo = Math.max(0, ctx.cart.totalDa - promoDiscount);
  const serviceFeeDa = computeServiceFeeDa(
    goodsAfterPromo,
    ctx.service_fee_tiers
  );
  const serviceFeeFreeInDa = daUntilFreeServiceFee(
    goodsAfterPromo,
    ctx.service_fee_tiers
  );
  // Crédit Roue (miroir de createOrder) : livraison payante + PAS de code
  // promo appliqué → remise plafonnée au frais réel.
  const wheelCreditDa =
    wheelCredit && isDelivery && deliveryFeeDa > 0 && !appliedPromo
      ? Math.min(deliveryFeeDa, wheelCredit.max_fee_da)
      : 0;
  const totalAfterPromo =
    goodsAfterPromo + serviceFeeDa + deliveryFeeDa - wheelCreditDa;
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
  // Sinon, le reste en ligne doit atteindre le minimum Chargily (le rail €
  // a ses propres bornes, vérifiées serveur avec message dédié).
  const onlineTooLow =
    payment === "online" &&
    onlineRail === "chargily" &&
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

  // Jauge « frais offerts » : progression vers le palier de gratuité — même
  // assiette que le frais (net réellement payé, code promo compris).
  const gaugePct =
    serviceFeeFreeInDa != null && serviceFeeFreeInDa > 0
      ? Math.max(
          8,
          Math.min(
            92,
            Math.round(
              (goodsAfterPromo / (goodsAfterPromo + serviceFeeFreeInDa)) * 100
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
          <h1 className="text-foreground text-heading-lg font-extrabold tracking-tight">
            {t("title")}
          </h1>
        </div>

        {/* Bloc boutique — logo dégradé sombre + eyebrow violet. */}
        <Block delay={0.02}>
          <div className="flex items-center gap-3 p-4">
            <span className="rounded-card grid size-[46px] shrink-0 place-items-center bg-gradient-to-br from-[#26262e] to-[#0b0b0f] text-white">
              <Store className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-primary-600 text-micro font-extrabold tracking-wider uppercase">
                {t("myOrder")}
              </p>
              <p className="text-foreground text-title truncate font-extrabold">
                {ctx.merchant.name}
              </p>
              <p className="text-muted text-label font-semibold">
                {t("itemsInCart", { count: totalUnits })}
              </p>
            </div>
            <Link
              href="/cart"
              className="text-primary-700 text-body-sm shrink-0 font-extrabold transition active:scale-90"
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
          cartSubtotalDa={ctx.cart.subtotalDa}
        />

        {/* Retrait — QUAND récupérer ? Le nom du commerce est déjà dans la
            carte « Ma commande » juste au-dessus (zéro doublon). Deux TUILES
            côte à côte (même langage que Express/Tournée) au lieu de deux
            grandes lignes radio empilées → moitié moins haut, plus clair. */}
        {!isDelivery && (
          <Block className="mt-3" delay={0.07}>
            <div className="space-y-2.5 p-4">
              <p className="text-muted text-caption font-extrabold tracking-wider uppercase">
                {t("pickupWhen")}
              </p>

              {!openNow && (
                <div className="border-warning-100 bg-warning-50 text-warning-800 rounded-control border px-3 py-2 text-xs">
                  {t("closedPickSlot")}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <PickupTile
                  checked={pickupType === "asap"}
                  onClick={() => setPickupType("asap")}
                  icon={<Clock className="size-4" />}
                  title={t("pickupNow")}
                  hint={formatAsapReady(
                    new Date(Date.now() + ctx.merchant.prep_time_min * 60_000),
                    new Date(),
                    locale
                  )}
                  disabled={!openNow}
                />
                <PickupTile
                  checked={pickupType === "slot"}
                  onClick={() => setPickupType("slot")}
                  icon={<CalendarGlyph />}
                  title={t("pickupSchedule")}
                  hint={
                    availableDays.length === 0
                      ? t("noSlotAvailable")
                      : t("upToDaysAhead", {
                          days: ctx.merchant.max_days_ahead,
                        })
                  }
                  disabled={availableDays.length === 0}
                />
              </div>
            </div>

            {pickupType === "slot" && availableDays.length > 0 && (
              <div className="-mt-1 space-y-2.5 px-4 pb-4">
                {/* JOURS — cartes calendrier (libellé court + numéro du jour),
                    défilement fluide avec snap : scannable d'un coup d'œil. */}
                <div className="scrollbar-hide -mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-0.5">
                  {availableDays.map((dayKey) => {
                    const sample = slotsByDay.get(dayKey)?.[0]?.start;
                    if (!sample) return null;
                    const { top, num } = formatDayCardParts(sample, locale);
                    const active = effectiveDayKey === dayKey;
                    return (
                      <button
                        key={dayKey}
                        ref={active ? activeDayRef : undefined}
                        type="button"
                        onClick={() => {
                          setChosenDayKey(dayKey);
                          setChosenSlotIdx(null);
                        }}
                        className={cn(
                          "flex w-[60px] shrink-0 snap-start flex-col items-center rounded-md border py-1.5 transition active:scale-[0.96]",
                          active
                            ? "border-primary-600 bg-primary-600 text-white"
                            : "border-border bg-surface hover:border-primary-300"
                        )}
                      >
                        <span
                          className={cn(
                            "text-micro-lg font-bold capitalize",
                            active ? "text-white/85" : "text-muted"
                          )}
                        >
                          {top}
                        </span>
                        <span className="text-title-lg leading-tight font-black tabular-nums">
                          {num}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* HEURES — UNE rangée horizontale à snap (comme les jours) :
                    une seule ligne compacte, pouce-friendly, l'heure choisie
                    se recentre automatiquement. */}
                <div
                  ref={hoursGridRef}
                  className="scrollbar-hide -mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-0.5"
                >
                  {slots.map((s, i) => {
                    const active = chosenSlotIdx === i;
                    return (
                      <button
                        key={s.start.toISOString()}
                        ref={active ? activeHourRef : undefined}
                        type="button"
                        onClick={() => setChosenSlotIdx(i)}
                        className={cn(
                          "text-body-sm shrink-0 snap-center rounded-full border px-3.5 py-2 font-bold tabular-nums transition active:scale-[0.95]",
                          active
                            ? "border-primary-600 bg-primary-600 text-white"
                            : "border-border bg-surface hover:border-primary-300"
                        )}
                      >
                        {formatTimeFr(s.start, locale)}
                      </button>
                    );
                  })}
                </div>

                {/* Confirmation du créneau choisi — phrase complète (plage),
                    zéro ambiguïté sur ce qui vient d'être sélectionné. */}
                {chosenSlotIdx != null && slots[chosenSlotIdx] && (
                  <p className="bg-success-50 text-success-700 rounded-control text-label-lg flex items-center gap-1.5 px-3 py-2 font-bold">
                    <Check className="size-4 shrink-0" />
                    {formatSlotRange(
                      slots[chosenSlotIdx].start,
                      slots[chosenSlotIdx].end,
                      new Date(),
                      locale
                    )}
                  </p>
                )}
              </div>
            )}
          </Block>
        )}

        {/* Paiement — DEUX cartes côte à côte + badge cashback comparatif. */}
        <Block className="mt-3" delay={0.12}>
          <SectionTitle icon={CreditCard} className="px-4 pt-4">
            {t("payment")}
          </SectionTitle>
          {/* CARROUSEL horizontal (scroll-snap, barre masquée) : les 3 moyens
              de paiement VISIBLES D'UN COUP (maquette) — un tiers de largeur
              chacun, défilement + points seulement si ça déborde. */}
          <div
            ref={payScrollRef}
            onScroll={updatePayDots}
            className="scrollbar-hide flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 pt-3 pb-2"
          >
            <PayCard
              icon={Banknote}
              selected={payment === "cash"}
              onClick={() => {
                setPayment("cash");
              }}
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
              className="min-w-[102px] shrink-0 basis-[calc((100%-16px)/3)] snap-start"
            />
            {onlineVisible && (
              <PayCard
                icon={CreditCard}
                selected={payment === "online" && onlineRail === "chargily"}
                onClick={() => {
                  if (!onlineUsable) return;
                  setPayment("online");
                  setOnlineRail("chargily");
                }}
                title={t("online")}
                bolt
                sub={
                  onlineUsable
                    ? t("onlineSub")
                    : onlinePaymentPersonal
                      ? t("unavailableOnAccount")
                      : "Bientôt"
                }
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
                className="min-w-[102px] shrink-0 basis-[calc((100%-16px)/3)] snap-start"
              />
            )}
            {/* (Le paiement par un proche N'EST PLUS un moyen de paiement ici :
                le propriétaire envoie le lien depuis la room « Inviter la
                famille », et c'est le proche qui règle sur /payer — même
                parcours, mêmes règles commerçant, sans accès au Coligo Pay ni
                au cashback du propriétaire.) */}
            {/* Carte internationale € — visible UNIQUEMENT si le serveur l'a
                jugée éligible (flag + pays IP + plafonds). Aucun taux ni
                montant € ici : le client paie son total en DA, la conversion
                s'affiche sur la feuille Stripe. */}
            {onlineVisible && onlineUsable && ctx.intl_payment.available && (
              <PayCard
                icon={Globe}
                selected={payment === "online" && onlineRail === "stripe_eur"}
                onClick={() => {
                  if (!ctx.merchant.accepts_online) return;
                  setPayment("online");
                  setOnlineRail("stripe_eur");
                }}
                title={t("intlCard")}
                sub={t("intlCardSub")}
                disabled={!ctx.merchant.accepts_online}
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
                className="min-w-[102px] shrink-0 basis-[calc((100%-16px)/3)] snap-start"
              />
            )}
          </div>

          {/* Points de pagination (maquette) — seulement si ça déborde. */}
          {payDots && payDots.count > 1 ? (
            <div className="flex items-center justify-center gap-1.5 pb-3">
              {Array.from({ length: payDots.count }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    i === payDots.active
                      ? "bg-primary-600 w-4"
                      : "bg-border-strong w-1.5"
                  )}
                />
              ))}
            </div>
          ) : (
            <div className="pb-2" />
          )}

          {/* Capacité € atteinte : bandeau informatif + « Me prévenir »
              (inline, état local — pas de toast). */}
          {onlineVisible &&
            onlineUsable &&
            ctx.intl_payment.capacity_blocked && (
              <div className="border-border bg-surface-2 rounded-card mx-4 mb-4 border px-3.5 py-3">
                <p className="text-foreground text-label-lg flex items-center gap-2 font-bold">
                  <Globe className="text-muted size-4 shrink-0" />
                  {t("intlCapacityTitle")}
                </p>
                <p className="text-muted text-caption-lg mt-1 font-medium">
                  {t("intlCapacityBody")}
                </p>
                {waitlistState === "done" ? (
                  <p className="text-success-600 text-label mt-2 inline-flex items-center gap-1.5 font-extrabold">
                    <Check className="size-3.5" />
                    {t("intlNotifyDone")}
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={waitlistState === "pending"}
                    onClick={() => {
                      setWaitlistState("pending");
                      void joinIntlWaitlist().then((r) =>
                        setWaitlistState(r.ok ? "done" : "idle")
                      );
                    }}
                    className="border-border text-foreground text-label mt-2 inline-flex h-8 items-center gap-1.5 rounded-full border px-3 font-extrabold disabled:opacity-60"
                  >
                    {waitlistState === "pending" && (
                      <Loader2 className="size-3.5 animate-spin" />
                    )}
                    {t("intlNotifyBtn")}
                  </button>
                )}
              </div>
            )}

          {/* Comparatif : en espèces, montre le gain MANQUÉ → tap = bascule. */}
          {payment === "cash" &&
            ctx.merchant.accepts_online &&
            onlineUsable &&
            cashbackOn &&
            onlineCashbackExtra > 0 && (
              <button
                type="button"
                onClick={() => setPayment("online")}
                className="bg-primary-50 rounded-card mx-4 mb-4 flex w-[calc(100%-2rem)] items-center gap-2.5 px-3.5 py-3 text-start transition active:scale-[0.99]"
              >
                <span className="text-primary-600 rounded-chip grid size-8 shrink-0 place-items-center bg-white">
                  <Gift className="size-4" />
                </span>
                <span className="text-primary-800 text-label-lg flex-1 leading-snug font-bold">
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

          {onlineTooLow && (
            <div className="border-danger-200 bg-danger-50 text-danger-800 rounded-control mx-4 mt-3 mb-1 border px-3 py-2 text-xs">
              {t.rich("onlineTooLow", {
                min: formatDA(CHARGILY_MIN_AMOUNT_DA),
                remaining: formatDA(totalAfterWallets),
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </div>
          )}
          {onlineFullyCovered && (
            <div className="border-success-200 bg-success-50 text-success-800 rounded-control mx-4 mt-3 mb-1 flex items-center gap-2 border px-3 py-2 text-xs">
              <Check className="size-4 shrink-0" />
              <span>
                {t.rich("onlineFullyCovered", {
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
              </span>
            </div>
          )}
        </Block>

        {/* Cartes de SOLDE (maquette) : Coligo Pay (violet) + Mon cashback
            (vert) — REDESIGN pur des anciens switches, mêmes conditions. */}
        {coligoPayOn && ctx.topup_balance_da > 0 && (
          <div className="mt-3">
            <WalletCard
              icon={Wallet}
              tone="primary"
              title="Coligo Pay"
              subLabel={t("walletBalanceShort")}
              amountLabel={formatDA(ctx.topup_balance_da)}
              checked={useTopup}
              onToggle={() => toggleWallet("topup")}
              delay={0.14}
            />
          </div>
        )}
        {cashbackOn && ctx.cashback_balance_da > 0 && (
          <div className="mt-3">
            <WalletCard
              icon={Gift}
              tone="success"
              title={t("myCashback")}
              subLabel={t("cashbackAvailable")}
              amountLabel={formatDA(ctx.cashback_balance_da)}
              savePillText={t("cashbackSavePill")}
              href="/cashback"
              checked={useCashback}
              onToggle={() => toggleWallet("cashback")}
              delay={0.16}
            />
          </div>
        )}

        {/* Promo + Note = lignes repliables compactes. */}
        <Block className="mt-3" delay={0.17}>
          {appliedPromo ? (
            <div className="flex items-center gap-3 p-4">
              <span className="bg-success-50 text-success-700 rounded-control grid size-[34px] shrink-0 place-items-center">
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
                  className="border-border bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 w-full rounded-md border px-3 py-2.5 text-sm uppercase focus-visible:ring-2 focus-visible:outline-none"
                />
                <button
                  type="button"
                  onClick={applyPromo}
                  disabled={promoChecking || promoInput.trim() === ""}
                  className="bg-foreground text-background shrink-0 rounded-md px-4 text-sm font-extrabold transition disabled:opacity-40"
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
                <p className="text-muted text-caption mb-2 flex items-center gap-2 font-extrabold tracking-wider uppercase">
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
                  className="border-border bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 w-full resize-none rounded-md border px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
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
            {serviceFeeDa > 0 && serviceFeeFreeInDa != null && (
              <div className="bg-primary-50 text-primary-700 rounded-card text-label-lg relative mb-3.5 flex items-center gap-2.5 overflow-hidden px-3.5 py-3 font-bold">
                <span className="text-primary-600 grid size-7 shrink-0 place-items-center rounded-sm bg-white">
                  <Zap className="size-3.5" />
                </span>
                <span>
                  {t.rich("serviceFeeFreeIn", {
                    amount: formatDA(serviceFeeFreeInDa),
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
              {serviceFeeDa > 0 ? (
                <RRow
                  label={t("serviceFee")}
                  value={`+ ${formatDA(serviceFeeDa)}`}
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
              {freeDeliveryApplies && hasValidDeliveryPosition ? (
                // Livraison offerte (tournée) : on BARRE le prix tournée normal
                // et on affiche « Gratuit » → le client voit ce qu'il a économisé.
                <div className="flex items-center justify-between py-[3px] text-sm">
                  <dt className="text-foreground font-semibold">
                    {t("deliveryTourLabel")}
                  </dt>
                  <dd className="flex items-center gap-2 tabular-nums">
                    {rawDeliveryFeeDa > 0 && (
                      <span className="text-muted font-medium line-through">
                        {formatDA(rawDeliveryFeeDa)}
                      </span>
                    )}
                    <span className="text-success-700 font-extrabold">
                      {t("freeDeliveryApplied")}
                    </span>
                  </dd>
                </div>
              ) : (
                deliveryFeeDa > 0 && (
                  <RRow
                    label={
                      delivery.mode === "tour"
                        ? t("deliveryTourLabel")
                        : t("deliveryFee")
                    }
                    value={formatDA(deliveryFeeDa)}
                  />
                )
              )}
              {/* Livraison offerte gagnée à la Roue Coligo (mig 0421). */}
              {wheelCreditDa > 0 && (
                <div className="text-body-sm flex items-center justify-between px-1">
                  <dt className="text-success-700 font-bold">
                    {t("wheelFreeDelivery")}
                  </dt>
                  <dd className="text-success-700 font-extrabold">
                    −{formatDA(wheelCreditDa)}
                  </dd>
                </div>
              )}
              {/* Nudge « plus que X pour la livraison offerte » (façon Uber Eats) :
                  tournée sélectionnée, offre existante, panier sous le minimum. */}
              {delivery.fulfillment === "delivery" &&
                delivery.mode === "tour" &&
                ctx.delivery.free_delivery != null &&
                !freeDeliveryApplies && (
                  <p className="text-accent-700 text-label px-1 font-semibold">
                    {t("freeDeliveryHint", {
                      amount: formatDA(
                        Math.max(
                          0,
                          ctx.delivery.free_delivery.min_subtotal_da -
                            ctx.cart.subtotalDa
                        )
                      ),
                    })}
                  </p>
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
          <div className="bg-success-50 co-rise relative mt-3 flex items-center gap-3 overflow-hidden rounded-lg p-3.5 shadow-[0_6px_18px_-10px_rgba(21,145,90,0.4)]">
            <span className="text-success-700 rounded-control-lg z-[2] grid size-9 shrink-0 place-items-center bg-white shadow-[0_3px_8px_-2px_rgba(21,145,90,0.35)]">
              <Gift className="size-[18px]" />
            </span>
            <p className="text-success-700 text-label-lg z-[2] leading-snug font-bold">
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
      <div className="border-border fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-40 border-t bg-white/95 px-4 pt-3 pb-3 shadow-[0_-8px_30px_rgba(40,35,90,0.1)] backdrop-blur-md lg:bottom-0">
        <div className="mx-auto max-w-[560px]">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <span className="text-muted text-label-lg font-semibold">
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
              "rounded-control relative inline-flex h-[54px] w-full items-center justify-center gap-2 overflow-hidden text-base font-extrabold transition-all",
              canSubmit
                ? "from-primary-400 to-primary-700 co-shine bg-gradient-to-br text-white active:scale-[0.98]"
                : "bg-foreground/90 cursor-not-allowed text-white opacity-50"
            )}
          >
            {submitting ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <span className="relative z-[2] flex items-center justify-center gap-2">
                {t("confirmOrder")}
                {/* Carte internationale : « ≈ X € » en petit (façon Uber) —
                    le client sait AVANT de confirmer ce que sa carte paiera. */}
                {payment === "online" &&
                  onlineRail === "stripe_eur" &&
                  totalAfterWallets > 0 && (
                    <IntlApproxTag
                      totalDa={totalAfterWallets}
                      className="text-label font-bold tabular-nums opacity-90"
                    />
                  )}
                <ChevronRight className="size-[18px]" />
              </span>
            )}
          </button>
          {blockReason && (
            <p className="text-warning-700 text-caption mt-2 flex items-center justify-center gap-1.5 text-center font-bold">
              <AlertTriangle className="size-3.5" />
              {blockReason}
            </p>
          )}
          {/* Erreur de création de commande (stock, prix, etc.) — EN LIGNE. */}
          {submitError && (
            <p className="text-danger-600 text-label mt-2 flex items-center justify-center gap-1.5 text-center font-bold">
              <AlertTriangle className="size-3.5" />
              {submitError}
            </p>
          )}
        </div>
      </div>

      {/* Feuille de paiement € EMBARQUÉE (carte + Apple Pay + Google Pay) —
          aucune redirection : tout se passe dans la page. Au succès, la page
          /checkout/success vide le panier et suit la confirmation webhook. */}
      {intlIntent && (
        <IntlPaymentSheet
          intent={intlIntent}
          onSuccess={() => {
            const orderId = intlIntent.order_id;
            setIntlIntent(null);
            setIsRedirecting(true);
            router.push(`/checkout/success?order_id=${orderId}`);
          }}
          onClose={() => {
            // Abandon AVANT paiement : panier intact, commande pending
            // (re-soumission idempotente ou filet d'expiration).
            setIntlIntent(null);
          }}
        />
      )}

      {/* Overlay de résultat NATIF (Chargily dans l'app). Succès → page de
          confirmation ; échec/annulation → suivi de commande (réessai possible). */}
      {pay.state && (
        <PaymentResultOverlay
          state={pay.state}
          title={t(resKey(pay.state).title)}
          sub={
            pay.state === "processing" ? undefined : t(resKey(pay.state).sub)
          }
          primaryLabel={
            pay.state === "success" ? t("resViewOrder") : t("resRetry")
          }
          onPrimary={() => {
            const oid = paidOrderRef.current;
            const success = pay.state === "success";
            pay.reset();
            if (success) {
              setIsRedirecting(true);
              router.push(`/checkout/success?order_id=${oid}`);
            } else if (oid) {
              setIsRedirecting(true);
              router.push(`/commandes/${oid}`);
            }
          }}
          secondaryLabel={
            pay.state !== "success" ? t("resViewOrder") : undefined
          }
          onSecondary={
            pay.state !== "success"
              ? () => {
                  const oid = paidOrderRef.current;
                  pay.reset();
                  if (oid) {
                    setIsRedirecting(true);
                    router.push(`/commandes/${oid}`);
                  }
                }
              : undefined
          }
        />
      )}

      {/* « Faire payer un proche » : commande créée, lien de paiement prêt —
          écran de partage plein écran (WhatsApp / copie / retour room). */}
    </div>
  );
}

/** Écran de partage du lien de paiement invité (panier partagé). */

function resKey(s: PaymentResultState): { title: string; sub: string } {
  switch (s) {
    case "processing":
      return { title: "resProcessing", sub: "resProcessing" };
    case "success":
      return { title: "resSuccess", sub: "resSuccessSub" };
    case "failed":
      return { title: "resFailed", sub: "resFailedSub" };
    case "cancelled":
      return { title: "resCancelled", sub: "resCancelledSub" };
    case "expired":
      return { title: "resExpired", sub: "resExpiredSub" };
  }
}
