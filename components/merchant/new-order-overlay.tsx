"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  Check,
  Clock,
  Loader2,
  PartyPopper,
  Printer,
  Timer,
  X,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { formatDA } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { fetchCategoryMap } from "@/lib/ticket/category-map";
import { updateOrderStatus } from "@/app/(merchant)/orders/actions";
import type { OrderStatus } from "@/lib/types";

export type NewOrder = {
  id: string;
  customer_name: string | null;
  total_da: number | null;
  /** Numéro de référence lisible (A042…) si présent dans le payload Realtime. */
  order_number?: string | null;
};

/** Délai (s) avant acceptation auto quand l'acceptation automatique est ON. */
const AUTO_ACCEPT_SECONDS = 10;
/** Délai (s) avant refus auto quand l'acceptation automatique est OFF. */
const AUTO_REFUSE_SECONDS = 15 * 60;

const REFUSAL_REASONS = [
  "Article(s) en rupture",
  "Trop de commandes (surcharge)",
  "Commerce fermé / fin de service",
  "Adresse hors zone de livraison",
  "Client injoignable",
  "Autre raison",
];

const AUTO_REFUSE_NOTE = "Refus automatique : non acceptée sous 15 min";

function opId(orderId: string, kind: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${kind}-${orderId}-${Date.now()}`;
}

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-DZ", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Algiers",
  });
}

type DetailItem = {
  name: string;
  qty: number;
  lineTotal: number;
};
type DetailGroup = { title: string; items: DetailItem[] };
type OrderDetails = {
  groups: DetailGroup[];
  totalUnits: number;
  subtotalDa: number;
  serviceFeeDa: number;
  cashbackDa: number;
  totalDa: number;
  pickupSlotAt: string | null;
  notes: string | null;
  paymentMethod: "cash" | "online";
  fulfillmentType: "pickup" | "delivery";
  deliveryMode: "express" | "tour" | null;
  deliveryFeeDa: number;
  deliveryAddress: string | null;
  customerPhone: string | null;
};

type Props = {
  /** Commande en tête de file à afficher, ou `null` si aucune. */
  order: NewOrder | null;
  /** Identifiant commerçant (pour résoudre les catégories des articles). */
  merchantId: string;
  /** Nombre de commandes encore en attente DERRIÈRE celle affichée. */
  queued?: number;
  /** Acceptation automatique activée côté commerçant. */
  autoAccept: boolean;
  /** Appelé quand la commande est résolue (acceptée/refusée) → passe à la suivante. */
  onResolved: () => void;
  /** Impression manuelle du ticket (optionnel). */
  onPrint?: (orderId: string) => void;
  canPrint?: boolean;
};

/**
 * Overlay plein écran « Nouvelle commande ! » — affiché sur TOUTES les pages
 * commerçant dès qu'une commande arrive, où que soit le commerçant dans l'app.
 *
 * Le DÉTAIL COMPLET de la commande (articles groupés par catégorie, créneau,
 * note, téléphone, total) est affiché DIRECTEMENT dans la pop-up, dans une zone
 * scrollable — plus besoin de cliquer « Voir le détail » et de quitter l'écran.
 * Les boutons Accepter / Refuser restent toujours visibles en bas.
 *
 * Deux modes selon le réglage « acceptation automatique » :
 *  - ON  : un bouton compte-à-rebours de 10 s. Acceptée automatiquement à la
 *          fin, sauf refus avant (ou acceptation immédiate d'un tap).
 *  - OFF : Accepter / Refuser + compte-à-rebours de 15 min (refus auto sinon).
 */
export function NewOrderOverlay({
  order,
  merchantId,
  queued = 0,
  autoAccept,
  onResolved,
  onPrint,
  canPrint = false,
}: Props) {
  const [acting, startActing] = useTransition();
  const [refusing, setRefusing] = useState(false);
  const initial = autoAccept ? AUTO_ACCEPT_SECONDS : AUTO_REFUSE_SECONDS;
  const [secondsLeft, setSecondsLeft] = useState(initial);
  const [details, setDetails] = useState<OrderDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Garde anti double-résolution : une commande ne doit être acceptée/refusée
  // qu'une seule fois, même si le commerçant tape pile au moment où le
  // compte-à-rebours atteint 0.
  const resolvedRef = useRef(false);

  const orderId = order?.id ?? null;

  // Bloque le scroll du body tant que l'overlay est ouvert.
  useEffect(() => {
    if (!orderId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [orderId]);

  // Charge le détail complet de la commande affichée (articles + catégories).
  useEffect(() => {
    if (!orderId) {
      setDetails(null);
      return;
    }
    let cancelled = false;
    setDetails(null);
    setLoadingDetails(true);
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("orders")
          .select(
            `total_da, service_fee_da, cashback_da, pickup_slot_at, notes,
             payment_method, fulfillment_type, delivery_mode, delivery_fee_da,
             delivery_address_text, customer_phone,
             order_items ( product_name, quantity, unit_price_da, line_total_da )`
          )
          .eq("id", orderId)
          .maybeSingle();
        if (cancelled || !data) {
          if (!cancelled) setLoadingDetails(false);
          return;
        }
        const items = (data.order_items ?? []) as {
          product_name: string;
          quantity: number;
          line_total_da: number;
        }[];
        const names = items.map((it) => it.product_name);
        const catMap = await fetchCategoryMap(supabase, merchantId, names);
        if (cancelled) return;

        // Regroupe par catégorie (ordre = première apparition).
        const order: string[] = [];
        const byCat = new Map<string, DetailItem[]>();
        for (const it of items) {
          const title = catMap[it.product_name]?.trim() || "Articles";
          if (!byCat.has(title)) {
            byCat.set(title, []);
            order.push(title);
          }
          byCat.get(title)!.push({
            name: it.product_name,
            qty: Number(it.quantity) || 0,
            lineTotal: it.line_total_da,
          });
        }
        const groups = order.map((title) => ({
          title,
          items: byCat.get(title)!,
        }));
        const subtotal = items.reduce((s, it) => s + it.line_total_da, 0);
        const totalUnits = items.reduce(
          (s, it) => s + (Number(it.quantity) || 0),
          0
        );

        setDetails({
          groups,
          totalUnits,
          subtotalDa: subtotal,
          serviceFeeDa: data.service_fee_da ?? 0,
          cashbackDa: data.cashback_da ?? 0,
          totalDa: data.total_da ?? 0,
          pickupSlotAt: data.pickup_slot_at ?? null,
          notes: data.notes ?? null,
          paymentMethod: (data.payment_method ?? "cash") as "cash" | "online",
          fulfillmentType: (data.fulfillment_type ?? "pickup") as
            | "pickup"
            | "delivery",
          deliveryMode: (data.delivery_mode ?? null) as
            | "express"
            | "tour"
            | null,
          deliveryFeeDa: data.delivery_fee_da ?? 0,
          deliveryAddress: data.delivery_address_text ?? null,
          customerPhone: data.customer_phone ?? null,
        });
      } catch {
        /* détails indisponibles : on garde au moins le résumé + actions */
      } finally {
        if (!cancelled) setLoadingDetails(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, merchantId]);

  const accept = useCallback(() => {
    if (!orderId || resolvedRef.current) return;
    resolvedRef.current = true;
    startActing(async () => {
      const res = await updateOrderStatus(
        orderId,
        "preparing" as OrderStatus,
        opId(orderId, "accept")
      );
      if (res.error) {
        toast.error(res.error);
        resolvedRef.current = false;
        return;
      }
      toast.success("Commande acceptée — en préparation");
      onResolved();
    });
  }, [orderId, onResolved]);

  const refuse = useCallback(
    (reason: string) => {
      if (!orderId || resolvedRef.current) return;
      resolvedRef.current = true;
      startActing(async () => {
        const res = await updateOrderStatus(
          orderId,
          "cancelled" as OrderStatus,
          opId(orderId, "refuse"),
          reason
        );
        if (res.error) {
          toast.error(res.error);
          resolvedRef.current = false;
          return;
        }
        toast.success("Commande refusée");
        onResolved();
      });
    },
    [orderId, onResolved]
  );

  // (Ré)initialise le compte-à-rebours à chaque nouvelle commande affichée et
  // décompte chaque seconde. À 0 : accepte (mode auto) ou refuse (mode manuel).
  useEffect(() => {
    if (!orderId) return;
    resolvedRef.current = false;
    setRefusing(false);
    setSecondsLeft(initial);

    const id = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(id);
          if (autoAccept) accept();
          else refuse(AUTO_REFUSE_NOTE);
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [orderId, autoAccept, initial, accept, refuse]);

  if (!order) return null;

  const ref = order.order_number ?? order.id.slice(0, 6).toUpperCase();
  const isDelivery = details?.fulfillmentType === "delivery";

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Nouvelle commande reçue"
      className="bg-primary-700/95 fixed inset-0 z-[95] flex items-center justify-center p-3 backdrop-blur-sm sm:p-4"
    >
      <div className="flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-[20px] bg-white shadow-2xl">
        {/* ─── En-tête (fixe) ─── */}
        <div className="bg-primary-700 relative shrink-0 px-5 py-4 text-white">
          {queued > 0 && (
            <span className="absolute top-3 right-4 inline-flex items-center rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">
              +{queued} en attente
            </span>
          )}
          <div className="text-primary-100 inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
            <PartyPopper className="size-4" />
            Nouvelle commande
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <h2 className="font-mono text-2xl font-bold">#{ref}</h2>
            {order.total_da != null && (
              <span className="text-lg font-semibold">
                {formatDA(order.total_da)}
              </span>
            )}
          </div>
          <p className="text-primary-50/90 mt-0.5 text-sm">
            {order.customer_name ?? "Client"}
            {details?.pickupSlotAt && (
              <span className="text-primary-100/80">
                {" · "}
                {isDelivery ? "Livrer pour" : "Retrait"}{" "}
                {fmtTime(details.pickupSlotAt)}
              </span>
            )}
          </p>
        </div>

        {/* ─── Détail scrollable ─── */}
        <div className="text-foreground min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {loadingDetails && !details ? (
            <div className="text-muted flex items-center justify-center gap-2 py-8 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Chargement du détail…
            </div>
          ) : details ? (
            <>
              {/* Bandeau mode / paiement */}
              <div className="flex flex-wrap gap-1.5">
                <Chip>{isDelivery ? "Livraison" : "Retrait"}</Chip>
                <Chip>
                  {details.paymentMethod === "online"
                    ? "Payé en ligne"
                    : "Cash"}
                </Chip>
                {isDelivery && details.deliveryMode && (
                  <Chip>
                    {details.deliveryMode === "express" ? "Express" : "Tournée"}
                  </Chip>
                )}
              </div>

              {/* Articles groupés par catégorie */}
              <div className="border-border divide-border divide-y overflow-hidden rounded-[12px] border">
                {details.groups.map((g) => (
                  <div key={g.title}>
                    <div className="bg-surface-2 text-subtle px-3 py-1.5 text-[11px] font-semibold tracking-wide uppercase">
                      {g.title}
                    </div>
                    <ul className="divide-border divide-y">
                      {g.items.map((it, i) => (
                        <li
                          key={`${it.name}-${i}`}
                          className="flex items-center gap-2.5 px-3 py-2"
                        >
                          <span className="bg-primary-50 text-primary-700 flex size-7 shrink-0 items-center justify-center rounded-[8px] text-xs font-bold tabular-nums">
                            {it.qty}×
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {it.name}
                          </span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">
                            {formatDA(it.lineTotal)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* Note client */}
              {details.notes && details.notes !== "seed" && (
                <div className="border-warning-200 bg-warning-50 rounded-[12px] border p-3">
                  <p className="text-warning-800 text-[11px] font-semibold tracking-wide uppercase">
                    Note du client
                  </p>
                  <p className="text-warning-900 mt-0.5 text-sm">
                    {details.notes}
                  </p>
                </div>
              )}

              {/* Récap montants */}
              <div className="border-border space-y-1.5 rounded-[12px] border p-3 text-sm">
                <Row
                  label={`Sous-total (${details.totalUnits} art.)`}
                  value={formatDA(details.subtotalDa)}
                />
                {details.serviceFeeDa > 0 && (
                  <Row
                    label="Frais de service"
                    value={formatDA(details.serviceFeeDa)}
                  />
                )}
                {isDelivery && details.deliveryFeeDa > 0 && (
                  <Row
                    label="Frais de livraison"
                    value={formatDA(details.deliveryFeeDa)}
                  />
                )}
                {details.cashbackDa > 0 && (
                  <Row
                    label="Cashback"
                    value={`-${formatDA(details.cashbackDa)}`}
                  />
                )}
                <div className="border-border flex justify-between border-t pt-1.5 font-bold">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {formatDA(details.totalDa)}
                  </span>
                </div>
              </div>

              {/* Adresse de livraison */}
              {isDelivery && details.deliveryAddress && (
                <p className="text-muted text-xs">
                  <span className="font-semibold">Adresse : </span>
                  {details.deliveryAddress}
                </p>
              )}

              <Link
                href={`/orders/${order.id}`}
                className="text-primary-700 inline-flex items-center gap-1 text-sm font-medium hover:underline"
              >
                Ouvrir la page complète
              </Link>
            </>
          ) : (
            <p className="text-muted py-6 text-center text-sm">
              Détail indisponible — vous pouvez quand même accepter ou refuser.
            </p>
          )}
        </div>

        {/* ─── Actions (fixe, en bas) ─── */}
        <div className="border-border shrink-0 border-t p-4">
          {autoAccept ? (
            <AutoAcceptControls
              secondsLeft={secondsLeft}
              acting={acting}
              onAcceptNow={accept}
              onRefuse={() => refuse("Refusée par le commerçant")}
            />
          ) : refusing ? (
            <RefuseReasons
              acting={acting}
              onPick={refuse}
              onCancel={() => setRefusing(false)}
            />
          ) : (
            <ManualControls
              secondsLeft={secondsLeft}
              acting={acting}
              onAccept={accept}
              onRefuse={() => setRefusing(true)}
              canPrint={canPrint}
              onPrint={onPrint ? () => onPrint(order.id) : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="border-border bg-surface-2 text-muted inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold">
      {children}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-muted flex justify-between">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** Mode acceptation automatique : un seul gros bouton compte-à-rebours. */
function AutoAcceptControls({
  secondsLeft,
  acting,
  onAcceptNow,
  onRefuse,
}: {
  secondsLeft: number;
  acting: boolean;
  onAcceptNow: () => void;
  onRefuse: () => void;
}) {
  const pct = Math.max(
    0,
    Math.min(100, (secondsLeft / AUTO_ACCEPT_SECONDS) * 100)
  );
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onAcceptNow}
        disabled={acting}
        className="bg-success-600 hover:bg-success-700 relative inline-flex h-14 w-full items-center justify-center overflow-hidden rounded-[14px] px-5 text-base font-bold text-white shadow-sm disabled:opacity-70"
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-white/25 transition-[width] duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
        <span className="relative inline-flex items-center gap-2">
          {acting ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Check className="size-5" />
          )}
          {acting
            ? "Acceptation…"
            : `Acceptée automatiquement dans ${secondsLeft}s`}
        </span>
      </button>
      <p className="text-muted text-center text-xs">
        Acceptation automatique activée · touchez pour accepter tout de suite
      </p>
      <button
        type="button"
        onClick={onRefuse}
        disabled={acting}
        className="border-danger-300 text-danger-700 hover:bg-danger-50 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border px-5 text-sm font-semibold disabled:opacity-50"
      >
        <X className="size-4" />
        Refuser plutôt
      </button>
    </div>
  );
}

/** Mode manuel : Accepter / Refuser + compte-à-rebours avant refus auto. */
function ManualControls({
  secondsLeft,
  acting,
  onAccept,
  onRefuse,
  canPrint,
  onPrint,
}: {
  secondsLeft: number;
  acting: boolean;
  onAccept: () => void;
  onRefuse: () => void;
  canPrint?: boolean;
  onPrint?: () => void;
}) {
  const urgent = secondsLeft <= 120;
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onAccept}
        disabled={acting}
        className="bg-success-600 hover:bg-success-700 inline-flex h-14 w-full items-center justify-center gap-2 rounded-[14px] px-5 text-base font-bold text-white shadow-sm disabled:opacity-60"
      >
        {acting ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <Check className="size-5" />
        )}
        Accepter
      </button>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRefuse}
          disabled={acting}
          className="border-danger-300 text-danger-700 hover:bg-danger-50 inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-[12px] border px-5 text-base font-semibold disabled:opacity-50"
        >
          <X className="size-5" />
          Refuser
        </button>
        {canPrint && onPrint && (
          <button
            type="button"
            onClick={onPrint}
            disabled={acting}
            className="border-border text-muted hover:bg-surface-2 inline-flex h-12 items-center justify-center gap-1.5 rounded-[12px] border px-4 text-sm font-medium disabled:opacity-50"
          >
            <Printer className="size-4" />
            Imprimer
          </button>
        )}
      </div>
      <p
        className={
          "inline-flex w-full items-center justify-center gap-1.5 text-center text-xs " +
          (urgent ? "text-danger-600 font-semibold" : "text-muted")
        }
      >
        <Timer className="size-3.5" />
        Refus automatique dans {mmss(secondsLeft)} si non acceptée
      </p>
    </div>
  );
}

/** Liste des motifs de refus (mode manuel). */
function RefuseReasons({
  acting,
  onPick,
  onCancel,
}: {
  acting: boolean;
  onPick: (reason: string) => void;
  onCancel: () => void;
}) {
  return (
    <div>
      <p className="text-muted px-1 pb-1.5 text-[11px] font-semibold tracking-wide uppercase">
        Motif du refus
      </p>
      <ul className="space-y-0.5">
        {REFUSAL_REASONS.map((r) => (
          <li key={r}>
            <button
              type="button"
              onClick={() => onPick(r)}
              disabled={acting}
              className="hover:bg-danger-50 text-foreground flex w-full items-center justify-between rounded-[10px] px-3 py-2.5 text-left text-sm disabled:opacity-50"
            >
              {r}
              {acting && <Loader2 className="size-4 animate-spin" />}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onCancel}
        disabled={acting}
        className="text-muted mt-1.5 w-full rounded-[10px] px-2 py-1.5 text-center text-xs hover:underline disabled:opacity-50"
      >
        Annuler
      </button>
    </div>
  );
}
