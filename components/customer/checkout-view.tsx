"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Banknote,
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
import type { OpeningHours } from "@/lib/types";
import {
  fetchCheckoutContext,
  type CheckoutContext,
} from "@/app/(customer)/checkout/context";
import {
  createOrder,
  previewPromoCode,
} from "@/app/(customer)/checkout/actions";
import { CHARGILY_MIN_AMOUNT_DA } from "@/lib/config/payment-limits";
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
};

export function CheckoutView({ customer }: Props) {
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
    deliveryNote: "",
  });
  const [conflictDismissed, setConflictDismissed] = useState(false);
  const showConflict = otherCarts.length > 0 && !conflictDismissed;
  // Cashback NON sélectionné par défaut (le client l'active via le toggle).
  const [useCashback, setUseCashback] = useState(false);
  const [useTopup, setUseTopup] = useState(true);
  const [isRedirecting, setIsRedirecting] = useState(false);
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

  // Force "cash" si l'online n'est pas accepté.
  useEffect(() => {
    if (ctx && !ctx.merchant.accepts_online && payment === "online") {
      setPayment("cash");
    }
  }, [ctx, payment]);

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

  if (isRedirecting) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center lg:py-20">
        <Loader2 className="text-primary-600 mx-auto size-6 animate-spin" />
        <p className="text-foreground mt-3 text-base font-semibold">
          {payment === "online"
            ? "Redirection vers Chargily Pay…"
            : "Commande confirmée — un instant…"}
        </p>
        <p className="text-muted mt-1 text-xs">
          {payment === "online"
            ? "Tu seras redirigé(e) dans un instant. Garde cette fenêtre ouverte."
            : "On t'emmène vers le récapitulatif de ta commande."}
        </p>
      </div>
    );
  }

  if (!cart.merchant_id || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center lg:py-20">
        <ShoppingCart className="text-primary-500 mx-auto size-12" />
        <h1 className="text-foreground mt-4 text-2xl font-bold">
          Ton panier est vide
        </h1>
        <Link
          href="/"
          className="bg-primary-600 hover:bg-primary-700 mt-6 inline-flex rounded-[10px] px-4 py-2 text-sm font-medium text-white"
        >
          Voir les commerces
        </Link>
      </div>
    );
  }

  if (loading || !ctx) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center lg:py-20">
        <Loader2 className="text-primary-600 mx-auto size-6 animate-spin" />
        <p className="text-muted mt-3 text-sm">Préparation du checkout…</p>
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
          ← Retour au panier
        </Link>
      </div>
    );
  }

  function submit() {
    if (pickupType === "slot" && chosenSlotIdx == null) {
      toast.error("Choisis un créneau de retrait.");
      return;
    }
    if (delivery.fulfillment === "delivery") {
      const hasSavedAddress = !!delivery.addressId;
      const hasConfirmedCustom =
        !!delivery.customPosition && delivery.positionConfirmed;
      if (!hasSavedAddress && !hasConfirmedCustom) {
        toast.error(
          "Confirme ta position exacte sur la carte ou choisis une adresse enregistrée."
        );
        return;
      }
      if (!delivery.mode) {
        toast.error("Choisis Express ou Tournée.");
        return;
      }
      if (delivery.mode === "tour" && !delivery.slotId) {
        toast.error("Choisis un créneau de tournée.");
        return;
      }
      const phoneForDelivery = (
        delivery.phoneOverride.trim() ||
        customer.phone ||
        ""
      ).trim();
      if (phoneForDelivery === "") {
        toast.error(
          "Ajoute un numéro de téléphone pour la livraison (aucun numéro sur ton profil)."
        );
        return;
      }
    }
    const slot = pickupType === "slot" ? slots[chosenSlotIdx!] : null;
    const clientOpId = crypto.randomUUID();

    startSubmit(async () => {
      const res = await createOrder({
        merchant_id: cart.merchant_id!,
        client_operation_id: clientOpId,
        items: cart.items.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
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
        cashback_to_use_da: useCashback ? cashbackApplied : 0,
        topup_to_use_da: useTopup ? topupApplied : 0,
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
  const deliveryFeeDa =
    selectedDeliveryAddr && !selectedDeliveryAddr.out_of_range
      ? (selectedDeliveryAddr.fee_da ?? 0)
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
  const deliveryReady =
    !isDelivery ||
    (hasValidDeliveryPosition &&
      delivery.mode != null &&
      (delivery.mode !== "tour" || !!delivery.slotId) &&
      deliveryPhone !== "");

  const totalUnits = ctx.lines.reduce((s, l) => s + l.quantity, 0);

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
        ? "À payer espèces à la livraison"
        : "À payer espèces au retrait"
      : "Payé en ligne";

  const resteLabel =
    payment === "cash" ? "Reste à payer espèces" : "Reste à payer en ligne";
  const barLabel =
    totalAfterWallets === 0 && walletUsed ? "Payé avec mes soldes" : totalLabel;

  // Message d'aide sous le bouton (livraison incomplète).
  const blockReason =
    isDelivery && !deliveryReady
      ? !hasValidDeliveryPosition
        ? "Confirme ta position de livraison sur la carte."
        : !delivery.mode
          ? "Choisis un mode de livraison (Express ou Tournée)."
          : delivery.mode === "tour" && !delivery.slotId
            ? "Choisis un créneau de tournée."
            : deliveryPhone === ""
              ? "Ajoute un numéro de téléphone pour la livraison."
              : ""
      : slotMissing
        ? "Choisis un créneau de retrait."
        : "";

  return (
    <>
      <div className="mx-auto max-w-[560px] px-4 pt-3 pb-44">
        {showConflict && (
          <CartConflictModal
            current={cart}
            others={otherCarts}
            onResolved={() => setConflictDismissed(true)}
          />
        )}

        <h1 className="text-foreground mb-3 text-[24px] font-black tracking-[-0.9px]">
          Finaliser ma commande
        </h1>

        {/* Boutique */}
        <Card>
          <div className="flex items-center gap-3">
            <span className="bg-foreground grid size-11 shrink-0 place-items-center rounded-[12px] text-white">
              <Store className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-foreground truncate text-[15px] font-extrabold">
                {ctx.merchant.name}
              </p>
              <p className="text-muted text-[12.5px] font-semibold">
                {totalUnits} article{totalUnits > 1 ? "s" : ""} dans ton panier
              </p>
            </div>
            <Link
              href="/cart"
              className="text-primary-700 shrink-0 text-[13px] font-bold"
            >
              Modifier
            </Link>
          </div>
        </Card>

        {/* Toggle Retrait / Livraison + détail livraison */}
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
          <Card className="mt-3">
            <CardH icon={Clock}>Créneau de retrait</CardH>
            <div className="flex items-center gap-2 text-[13.5px] font-semibold">
              <Store className="text-primary-600 size-4 shrink-0" />À récupérer
              chez {ctx.merchant.name}
            </div>

            {!openNow && (
              <div className="border-warning-100 bg-warning-50 text-warning-800 mt-3 rounded-[10px] border px-3 py-2 text-xs">
                Le commerce est <strong>fermé pour le moment</strong>. Choisis
                un créneau ci-dessous.
              </div>
            )}

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <PickChoice
                checked={pickupType === "asap"}
                onClick={() => setPickupType("asap")}
                title="Préparation immédiate"
                hint={formatAsapReady(
                  new Date(Date.now() + ctx.merchant.prep_time_min * 60_000)
                )}
                disabled={!openNow}
              />
              <PickChoice
                checked={pickupType === "slot"}
                onClick={() => setPickupType("slot")}
                title="Choisir un créneau"
                hint={
                  availableDays.length === 0
                    ? "Pas de créneau disponible"
                    : `Jusqu'à ${ctx.merchant.max_days_ahead} j à l'avance`
                }
                disabled={availableDays.length === 0}
              />
            </div>

            {pickupType === "slot" && availableDays.length > 0 && (
              <div className="mt-3 space-y-2">
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
                          "shrink-0 rounded-[10px] border px-3 py-1.5 text-xs font-medium capitalize transition",
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
                        "rounded-[10px] border px-3 py-1.5 text-sm font-medium tabular-nums transition",
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
          </Card>
        )}

        {/* Paiement */}
        <Card className="mt-3">
          <CardH icon={CreditCard}>Paiement</CardH>
          <div className="space-y-2">
            <PayOption
              icon={Banknote}
              selected={payment === "cash"}
              onClick={() => setPayment("cash")}
              title={
                isDelivery ? "Espèces à la livraison" : "Espèces au retrait"
              }
              sub={
                isDelivery
                  ? "Tu règles le livreur à la remise"
                  : "Tu règles le commerçant au comptoir"
              }
              disabled={!ctx.merchant.accepts_cash}
            />
            <PayOption
              icon={CreditCard}
              selected={payment === "online"}
              onClick={() => setPayment("online")}
              title="En ligne"
              bolt
              sub="Carte CIB / EDAHABIA · Cashback bonus"
              disabled={!ctx.merchant.accepts_online}
            />
          </div>
          {onlineTooLow && (
            <div className="border-danger-200 bg-danger-50 text-danger-800 mt-3 rounded-[10px] border px-3 py-2 text-xs">
              Le montant minimum de paiement en ligne est de{" "}
              <strong>{formatDA(CHARGILY_MIN_AMOUNT_DA)}</strong>. Après tes
              soldes (cashback / Coligo Pay), il ne reste que{" "}
              <strong>{formatDA(totalAfterWallets)}</strong> à régler en ligne.
              Ajoute des articles à ton panier, ou réduis le cashback / Coligo
              Pay utilisé — ou paie en espèces.
            </div>
          )}
          {onlineFullyCovered && (
            <div className="border-success-200 bg-success-50 text-success-800 mt-3 flex items-center gap-2 rounded-[10px] border px-3 py-2 text-xs">
              <Check className="size-4 shrink-0" />
              <span>
                Tes soldes couvrent <strong>toute la commande</strong> — aucun
                paiement en ligne n&apos;est nécessaire.
              </span>
            </div>
          )}

          {/* Soldes utilisables — DEUX toggles séparés, cumulables (visible si
              solde > 0). Le cashback ne sert qu'à payer → jamais masqué. */}
          {ctx.cashback_balance_da > 0 && (
            <WalletToggleRow
              icon={Gift}
              title="Mon cashback"
              sub={`Disponible : ${formatDA(ctx.cashback_balance_da)}`}
              checked={useCashback}
              onToggle={() => setUseCashback((v) => !v)}
            />
          )}
          {ctx.topup_balance_da > 0 && (
            <WalletToggleRow
              icon={Wallet}
              title="Coligo Pay"
              sub={`Solde : ${formatDA(ctx.topup_balance_da)}`}
              checked={useTopup}
              onToggle={() => setUseTopup((v) => !v)}
            />
          )}
        </Card>

        {/* Note */}
        <Card className="mt-3">
          <CardH icon={Sparkles}>Note au commerçant</CardH>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={300}
            placeholder="Ex. « sans sachet », « pas de sucre »…"
            className="border-border bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 w-full resize-none rounded-[12px] border px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />
        </Card>

        {/* Code promo */}
        <Card className="mt-3">
          <CardH icon={Tag}>Code promo</CardH>
          {appliedPromo ? (
            <div className="border-success-200 bg-success-50 flex items-center justify-between gap-3 rounded-[12px] border px-3 py-2.5">
              <span className="text-success-800 flex items-center gap-2 text-sm font-extrabold">
                <Check className="size-4 shrink-0" />
                Code «&nbsp;{appliedPromo.code}&nbsp;» appliqué · −
                {formatDA(appliedPromo.discount_da)}
              </span>
              <button
                type="button"
                onClick={clearPromo}
                className="text-muted hover:text-foreground grid size-7 shrink-0 place-items-center rounded-full transition"
                aria-label="Retirer le code promo"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  value={promoInput}
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
                  placeholder="Ex. BIENVENUE10"
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
                    "Appliquer"
                  )}
                </button>
              </div>
              {promoError && (
                <p className="text-danger-600 mt-2 text-xs font-semibold">
                  {promoError}
                </p>
              )}
            </>
          )}
        </Card>

        {/* Récap */}
        <Card className="mt-3">
          <CardH icon={Receipt}>Récap</CardH>
          {ctx.service_fee_da > 0 && ctx.service_fee_free_in_da != null && (
            <div className="from-primary-50 text-primary-700 mb-3 flex items-center gap-2 rounded-[11px] bg-gradient-to-br to-[#F4F0FF] px-3 py-2.5 text-[12.5px] font-bold">
              <Zap className="text-primary-600 size-4 shrink-0" />
              <span>
                Encore <strong>{formatDA(ctx.service_fee_free_in_da)}</strong>{" "}
                pour les frais de service offerts !
              </span>
            </div>
          )}
          <dl className="space-y-1">
            <RRow label="Sous-total" value={formatDA(ctx.cart.subtotalDa)} />
            {ctx.cart.savingsDa > 0 && (
              <RRow
                label="Promo"
                value={`− ${formatDA(ctx.cart.savingsDa)}`}
                tone="success"
              />
            )}
            {ctx.service_fee_da > 0 ? (
              <RRow
                label="Frais de service"
                value={`+ ${formatDA(ctx.service_fee_da)}`}
              />
            ) : (
              ctx.cart.totalDa > 0 && (
                <RRow label="Frais de service" value="Gratuit" tone="success" />
              )
            )}
            {deliveryFeeDa > 0 && (
              <RRow label="Livraison" value={formatDA(deliveryFeeDa)} />
            )}
            {promoDiscount > 0 && (
              <RRow
                label={`Code promo (${appliedPromo?.code})`}
                value={`− ${formatDA(promoDiscount)}`}
                tone="success"
              />
            )}

            {walletUsed ? (
              <>
                <RRow
                  label="Total commande"
                  value={formatDA(totalAfterPromo)}
                />
                <hr className="border-border my-2" />
                {cashbackApplied > 0 && (
                  <RRow
                    label="Cashback utilisé"
                    value={`− ${formatDA(cashbackApplied)}`}
                    tone="success"
                  />
                )}
                {topupApplied > 0 && (
                  <RRow
                    label="Coligo Pay utilisé"
                    value={`− ${formatDA(topupApplied)}`}
                    tone="success"
                  />
                )}
                <hr className="border-border my-2" />
                <TotRow
                  label={resteLabel}
                  value={formatDA(totalAfterWallets)}
                />
              </>
            ) : (
              <>
                <hr className="border-border my-2" />
                <TotRow
                  label={totalLabel}
                  value={formatDA(totalAfterWallets)}
                />
              </>
            )}
          </dl>

          {/* Cashback GAGNÉ = gain futur (jamais un frais). Encadré vert. */}
          {payment === "online" && ctx.cart.totalDa > 0 && (
            <div className="bg-success-50 mt-3 flex items-center gap-2.5 rounded-[11px] p-3">
              <span className="text-success-700 grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-white">
                <Gift className="size-4" />
              </span>
              <p className="text-success-700 text-[12.5px] font-bold">
                Tu gagnes{" "}
                <strong className="font-extrabold">
                  {formatDA(Math.round(ctx.cart.totalDa * 0.03))}
                </strong>{" "}
                de cashback pour ta prochaine commande
              </p>
            </div>
          )}

          {ctx.merchant.min_order_da > 0 &&
            ctx.cart.totalDa < ctx.merchant.min_order_da && (
              <p className="text-danger-600 mt-2 text-xs">
                Minimum {formatDA(ctx.merchant.min_order_da)} — rajoute des
                articles pour valider.
              </p>
            )}
        </Card>
      </div>

      {/* ── Barre d'action UNIQUE, fixe en bas ── */}
      <div className="border-border fixed inset-x-0 bottom-16 z-40 border-t bg-white px-4 pt-3 pb-3 shadow-[0_-6px_24px_rgba(40,35,90,0.09)] lg:bottom-0">
        <div className="mx-auto max-w-[560px]">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <span className="text-muted text-[12.5px] font-semibold">
              {barLabel}
            </span>
            <span className="text-foreground text-[21px] font-extrabold tracking-tight tabular-nums">
              {formatDA(totalAfterWallets)}
            </span>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              "inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] text-base font-extrabold transition-colors",
              canSubmit
                ? "bg-primary-600 hover:bg-primary-700 text-white shadow-[0_8px_22px_-6px_rgba(91,91,230,0.55)]"
                : "bg-foreground/90 cursor-not-allowed text-white opacity-60"
            )}
          >
            {submitting ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              "Confirmer la commande"
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
    </>
  );
}

// ── Sous-composants visuels (style Uber, accent violet) ──

function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "border-border bg-surface rounded-[16px] border p-4 shadow-sm",
        className
      )}
    >
      {children}
    </section>
  );
}

function CardH({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <h2 className="text-muted mb-3 flex items-center gap-2 text-[12px] font-bold tracking-wide uppercase">
      <Icon className="text-foreground size-[15px]" />
      {children}
    </h2>
  );
}

function PayOption({
  icon: Icon,
  selected,
  onClick,
  title,
  sub,
  bolt,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  selected: boolean;
  onClick: () => void;
  title: string;
  sub: string;
  bolt?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-[13px] border p-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "border-primary-500 bg-primary-50"
          : "border-border bg-surface hover:border-primary-300"
      )}
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-[11px]",
          selected
            ? "text-primary-600 bg-white"
            : "bg-surface-2 text-foreground"
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground flex items-center gap-1.5 text-sm font-extrabold">
          {title}
          {bolt && (
            <span className="bg-warning-50 text-warning-700 grid size-[18px] place-items-center rounded-[5px]">
              <Zap className="size-3" />
            </span>
          )}
        </span>
        <span className="text-muted mt-0.5 block text-[11.5px] font-semibold">
          {sub}
        </span>
      </span>
      <span
        className={cn(
          "grid size-[21px] shrink-0 place-items-center rounded-full border-2",
          selected ? "border-primary-600" : "border-border-strong"
        )}
      >
        {selected && (
          <span className="bg-primary-600 size-[11px] rounded-full" />
        )}
      </span>
    </button>
  );
}

function PickChoice({
  checked,
  onClick,
  title,
  hint,
  disabled,
}: {
  checked: boolean;
  onClick: () => void;
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
        "rounded-[12px] border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "border-primary-600 ring-primary-100 ring-2"
          : "border-border bg-surface hover:border-primary-300"
      )}
    >
      <span className="text-foreground block text-sm font-bold">{title}</span>
      {hint && <span className="text-muted block text-xs">{hint}</span>}
    </button>
  );
}

/** Toggle de solde (cashback / Coligo Pay) — encart violet doux, façon Uber. */
function WalletToggleRow({
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
      className="border-primary-100 from-primary-50 mt-2.5 flex w-full items-center gap-3 rounded-[13px] border bg-gradient-to-br to-[#F5F2FF] p-3 text-left"
    >
      <span className="text-primary-600 grid size-[38px] shrink-0 place-items-center rounded-[11px] bg-white">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block text-[13.5px] font-extrabold">
          {title}
        </span>
        <span className="text-primary-700 block text-[11.5px] font-bold">
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
            checked ? "translate-x-[22px]" : "translate-x-[3px]"
          )}
        />
      </span>
    </button>
  );
}

/** Ligne total en gras (récap). */
function TotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between pt-0.5">
      <dt className="text-foreground text-base font-extrabold">{label}</dt>
      <dd className="text-foreground text-base font-extrabold tabular-nums">
        {value}
      </dd>
    </div>
  );
}

function RRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "primary";
}) {
  return (
    <div className="flex items-center justify-between py-0.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd
        className={cn(
          "font-semibold tabular-nums",
          tone === "success"
            ? "text-success-700"
            : tone === "primary"
              ? "text-primary-700"
              : "text-foreground"
        )}
      >
        {value}
      </dd>
    </div>
  );
}
