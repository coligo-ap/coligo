"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  Clock,
  CreditCard,
  Loader2,
  ShoppingBag,
  Sparkles,
  Store,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatDA } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { clearCart, useCart } from "@/lib/customer/cart-store";
import { generateTodaySlots, type Slot } from "@/lib/customer/pickup-slots";
import { normalizeOpeningHours } from "@/lib/merchant/opening-hours";
import type { OpeningHours } from "@/lib/types";
import {
  fetchCheckoutContext,
  type CheckoutContext,
} from "@/app/(customer)/checkout/context";
import { createOrder } from "@/app/(customer)/checkout/actions";
import type { PaymentMethod } from "@/lib/types";

type Props = {
  customer: { full_name: string; phone: string };
};

export function CheckoutView({ customer }: Props) {
  const router = useRouter();
  const cart = useCart();
  const [ctx, setCtx] = useState<CheckoutContext | null>(null);
  const [loading, startLoad] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [pickupType, setPickupType] = useState<"asap" | "slot">("asap");
  const [chosenSlotIdx, setChosenSlotIdx] = useState<number | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");

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

  // Force "cash" si l'online n'est pas accepté.
  useEffect(() => {
    if (ctx && !ctx.merchant.accepts_online && payment === "online") {
      setPayment("cash");
    }
  }, [ctx, payment]);

  const slots: Slot[] = useMemo(() => {
    if (!ctx) return [];
    const hours = normalizeOpeningHours(
      ctx.merchant.opening_hours as Partial<OpeningHours> | null
    );
    return generateTodaySlots(hours, {
      slotMinutes: ctx.merchant.pickup_slot_minutes,
      prepMinutes: ctx.merchant.prep_time_min,
      limit: 16,
    });
  }, [ctx]);

  if (!cart.merchant_id || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center lg:py-20">
        <ShoppingBag className="text-primary-500 mx-auto size-12" />
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
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      clearCart();
      router.push(`/commandes/${res.order_id}`);
    });
  }

  const totalLabel =
    payment === "cash"
      ? "À payer en espèces au retrait"
      : "Total payé en ligne";

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-4 pb-32 lg:px-6 lg:py-8 lg:pb-12">
      <header className="mb-5">
        <h1 className="text-foreground text-2xl font-bold lg:text-3xl">
          Finaliser ma commande
        </h1>
        <p className="text-muted text-sm">
          Connecté en tant que{" "}
          <span className="text-foreground font-medium">
            {customer.full_name}
          </span>{" "}
          · {customer.phone}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* Colonne principale */}
        <div className="space-y-5">
          {/* Rappel commerce */}
          <Section icon={Store} title={`Chez ${ctx.merchant.name}`}>
            <ul className="divide-border bg-surface divide-y rounded-[12px]">
              {ctx.lines.map((l) => (
                <li
                  key={l.product_id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                >
                  <span className="text-foreground line-clamp-1">
                    {l.quantity}× {l.name}
                  </span>
                  <span className="text-foreground tabular-nums">
                    {formatDA(l.line_total_da)}
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href="/cart"
              className="text-primary-700 mt-2 inline-flex text-xs font-medium hover:underline"
            >
              Modifier mon panier
            </Link>
          </Section>

          {/* Retrait */}
          <Section icon={Clock} title="Retrait">
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice
                checked={pickupType === "asap"}
                onClick={() => setPickupType("asap")}
                title="Dès que prêt"
                hint={`Prêt vers ${new Date(
                  Date.now() + ctx.merchant.prep_time_min * 60_000
                ).toLocaleTimeString("fr-DZ", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`}
              />
              <Choice
                checked={pickupType === "slot"}
                onClick={() => setPickupType("slot")}
                title="Choisir un créneau"
                hint={
                  slots.length === 0
                    ? "Pas de créneau disponible aujourd'hui"
                    : `${slots.length} créneaux dispos`
                }
                disabled={slots.length === 0}
              />
            </div>
            {pickupType === "slot" && (
              <div className="mt-3 flex flex-wrap gap-1.5">
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
            )}
          </Section>

          {/* Paiement */}
          <Section icon={CreditCard} title="Paiement">
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice
                checked={payment === "cash"}
                onClick={() => setPayment("cash")}
                title="Espèces au retrait"
                hint="Tu règles le commerçant en main propre"
                icon={Banknote}
                disabled={!ctx.merchant.accepts_cash}
              />
              <Choice
                checked={payment === "online"}
                onClick={() => setPayment("online")}
                title="En ligne ⚡"
                hint="Plus de cashback · Commande prioritaire"
                icon={Sparkles}
                disabled={!ctx.merchant.accepts_online}
                comingSoon
              />
            </div>
            {payment === "online" && (
              <div className="border-warning-100 bg-warning-50 text-warning-700 mt-3 rounded-[10px] border px-3 py-2 text-xs">
                Le paiement Chargily sera branché prochainement. Pour
                l&apos;instant, ta commande sera créée en « paiement en attente
                » — le commerçant ne la verra qu&apos;une fois le paiement
                confirmé.
              </div>
            )}
          </Section>

          {/* Note */}
          <Section icon={Sparkles} title="Note au commerçant (optionnel)">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder="Ex. « sans sachet », « pas de sucre »…"
              className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 w-full rounded-[12px] border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
          </Section>
        </div>

        {/* Récap sticky (desktop) */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="border-border bg-surface rounded-[16px] border p-5 shadow-sm">
            <h2 className="text-foreground mb-3 text-base font-bold">Récap</h2>
            <dl className="space-y-1.5 text-sm">
              <Row label="Sous-total" value={formatDA(ctx.cart.subtotalDa)} />
              {ctx.cart.savingsDa > 0 && (
                <Row
                  label="Promo"
                  value={`− ${formatDA(ctx.cart.savingsDa)}`}
                  tone="success"
                />
              )}
              {payment === "online" && ctx.cart.totalDa > 0 && (
                <Row
                  label="Cashback estimé"
                  value={`+ ${formatDA(Math.round(ctx.cart.totalDa * 0.03))}`}
                  tone="primary"
                />
              )}
              <div className="border-border my-2 border-t" />
              <Row label={totalLabel} value={formatDA(ctx.cart.totalDa)} bold />
            </dl>

            <Button
              type="button"
              className="mt-4 w-full"
              size="lg"
              onClick={submit}
              disabled={
                submitting || (pickupType === "slot" && chosenSlotIdx == null)
              }
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Confirmer la commande"
              )}
            </Button>

            {ctx.merchant.min_order_da > 0 &&
              ctx.cart.totalDa < ctx.merchant.min_order_da && (
                <p className="text-danger-600 mt-2 text-xs">
                  Minimum {formatDA(ctx.merchant.min_order_da)} — rajoute des
                  articles pour valider.
                </p>
              )}
          </div>
        </aside>
      </div>

      {/* Sticky bottom bar mobile */}
      <div className="fixed inset-x-0 bottom-16 z-30 px-4 pb-2 lg:hidden">
        <div className="border-border bg-surface mx-auto max-w-md rounded-[16px] border p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted">{totalLabel}</span>
            <span className="text-foreground text-base font-bold tabular-nums">
              {formatDA(ctx.cart.totalDa)}
            </span>
          </div>
          <Button
            type="button"
            className="w-full"
            size="lg"
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Confirmer"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border bg-surface rounded-[16px] border p-5">
      <header className="mb-3 flex items-center gap-2">
        <Icon className="text-primary-600 size-4" />
        <h2 className="text-foreground text-base font-semibold">{title}</h2>
      </header>
      {children}
    </section>
  );
}

function Choice({
  checked,
  onClick,
  title,
  hint,
  icon: Icon,
  disabled,
  comingSoon,
}: {
  checked: boolean;
  onClick: () => void;
  title: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  comingSoon?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "border-border bg-surface hover:border-primary-300 flex items-start gap-3 rounded-[12px] border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50",
        checked && "border-primary-600 ring-primary-100 ring-2"
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            "mt-0.5 size-4 shrink-0",
            checked ? "text-primary-700" : "text-muted"
          )}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="text-foreground flex items-center gap-2 text-sm font-semibold">
          {title}
          {comingSoon && (
            <span className="bg-warning-100 text-warning-700 rounded-full px-1.5 py-0.5 text-[10px]">
              bientôt
            </span>
          )}
        </span>
        {hint && <span className="text-muted block text-xs">{hint}</span>}
      </span>
    </button>
  );
}

function Row({
  label,
  value,
  bold,
  tone,
}: {
  label: string;
  value: string;
  bold?: boolean;
  tone?: "success" | "primary";
}) {
  return (
    <div className="flex items-center justify-between">
      <dt
        className={cn(
          "text-muted",
          bold && "text-foreground text-sm font-semibold"
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          "tabular-nums",
          bold ? "text-foreground text-base font-bold" : "text-foreground",
          tone === "success" && "text-success-700 font-semibold",
          tone === "primary" && "text-primary-700 font-semibold"
        )}
      >
        {value}
      </dd>
    </div>
  );
}
