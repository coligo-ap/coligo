"use client";

/**
 * BOARD opérationnel des commandes (style « cuisine » / KDS).
 *
 * 3 colonnes — À confirmer → En préparation → Prêtes — où chaque commande est
 * une carte qu'on fait AVANCER d'un tap (Accepter / Prête / Valider). Conçu
 * pour gérer beaucoup de commandes par jour d'un coup d'œil. Centre de pilotage
 * du dashboard commerçant.
 *
 * - Données fournies par le Server Component parent (dashboard) ; le board se
 *   re-rend automatiquement quand `OrderRealtimeBridge` appelle `router.refresh()`
 *   à l'arrivée/changement d'une commande.
 * - Actions = Server Actions existantes (`updateOrderStatus`, refus avec motif),
 *   donc audit `order_events` + push client conservés.
 * - Mobile : un sélecteur de colonne (1 colonne à la fois) ; ≥ lg : 3 colonnes.
 */

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Bike,
  Check,
  Clock,
  Inbox,
  Loader2,
  Package,
  QrCode,
  ShoppingBag,
  StickyNote,
  X,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { cn, formatDA } from "@/lib/utils";
import {
  updateOrderStatus,
  cancelOrderByMerchant,
} from "@/app/(merchant)/orders/actions";
import type { OrderWithItems } from "@/lib/types";
import {
  deliveryPhase,
  type DeliveryPhaseTone,
} from "@/lib/delivery/merchant-status";

const REFUSAL_REASONS = [
  "Article(s) en rupture",
  "Trop de commandes (surcharge)",
  "Commerce fermé / fin de service",
  "Adresse hors zone de livraison",
  "Client injoignable",
  "Autre raison",
];

type Column = {
  key: "pending" | "preparing" | "ready";
  title: string;
  statuses: OrderWithItems["status"][];
  icon: React.ComponentType<{ className?: string }>;
  /** classes accent de l'en-tête de colonne */
  accent: string;
  dot: string;
};

const COLUMNS: Column[] = [
  {
    key: "pending",
    title: "À confirmer",
    statuses: ["pending"],
    icon: Inbox,
    accent: "text-warning-700",
    dot: "bg-warning-500",
  },
  {
    key: "preparing",
    title: "En préparation",
    statuses: ["accepted", "preparing"],
    icon: Package,
    accent: "text-primary-700",
    dot: "bg-primary-500",
  },
  {
    key: "ready",
    title: "Prêtes",
    statuses: ["ready"],
    icon: ShoppingBag,
    accent: "text-success-700",
    dot: "bg-success-500",
  },
];

/** Horloge client (ms) qui tique toutes les 30 s. `null` avant montage. */
function useNowTick(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function OrderBoard({ orders }: { orders: OrderWithItems[] }) {
  const [active, setActive] = useState<Column["key"]>("pending");
  const now = useNowTick();

  const byColumn = useMemo(() => {
    const map: Record<Column["key"], OrderWithItems[]> = {
      pending: [],
      preparing: [],
      ready: [],
    };
    for (const o of orders) {
      const col = COLUMNS.find((c) => c.statuses.includes(o.status));
      if (col) map[col.key].push(o);
    }
    // ── Ordre de traitement pensé pour le RUSH (le plus urgent EN HAUT) ──
    // À confirmer : première venue d'abord (FIFO) — c'est elle qui attend le
    // plus et qui risque l'auto-refus à 15 min.
    map.pending.sort(
      (a, b) => +new Date(a.created_at) - +new Date(b.created_at)
    );
    // En préparation : par ÉCHÉANCE (heure « prête pour » = pickup_slot_at) —
    // ce qui doit sortir le plus tôt / est le plus en retard remonte en haut.
    map.preparing.sort(
      (a, b) =>
        +new Date(a.pickup_slot_at) - +new Date(b.pickup_slot_at) ||
        +new Date(a.created_at) - +new Date(b.created_at)
    );
    // Prêtes : la plus ancienne d'abord (elle attend le client depuis le plus
    // longtemps — on ne l'oublie pas).
    map.ready.sort(
      (a, b) =>
        +new Date(a.pickup_slot_at) - +new Date(b.pickup_slot_at) ||
        +new Date(a.created_at) - +new Date(b.created_at)
    );
    return map;
  }, [orders]);

  // Nombre de commandes « à traiter MAINTENANT » par colonne (mêmes seuils que
  // le clignotement des cartes). Sert à pointer la colonne concernée — sur
  // mobile surtout, où une seule colonne est visible à la fois.
  const alertCount = useMemo(() => {
    const min = (from: string) =>
      now === null ? -Infinity : (now - new Date(from).getTime()) / 60_000;
    return {
      pending: byColumn.pending.filter((o) => min(o.created_at) >= 11).length,
      preparing: byColumn.preparing.filter((o) => min(o.pickup_slot_at) >= 1)
        .length,
      ready: 0,
    } as Record<Column["key"], number>;
  }, [byColumn, now]);

  return (
    <div>
      {/* Sélecteur de colonne — mobile uniquement */}
      <div className="mb-3 grid grid-cols-3 gap-1.5 lg:hidden">
        {COLUMNS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setActive(c.key)}
            className={cn(
              "relative flex flex-col items-center gap-0.5 rounded-[12px] border px-2 py-2 text-xs font-semibold transition-colors",
              active === c.key
                ? "border-primary-600 bg-primary-50 text-primary-700"
                : "border-border text-muted bg-white",
              alertCount[c.key] > 0 && "border-danger-400 bg-danger-50"
            )}
          >
            {alertCount[c.key] > 0 && (
              <span className="bg-danger-500 absolute -top-1.5 -right-1.5 inline-flex min-w-[18px] animate-pulse items-center justify-center rounded-full px-1 text-[10px] font-extrabold text-white tabular-nums">
                {alertCount[c.key]}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", c.dot)} />
              {c.title}
            </span>
            <span className="text-base font-bold tabular-nums">
              {byColumn[c.key].length}
            </span>
          </button>
        ))}
      </div>

      {/* Colonnes */}
      <div className="grid gap-3 lg:grid-cols-3">
        {COLUMNS.map((c) => (
          <section
            key={c.key}
            className={cn(
              "min-w-0",
              active === c.key ? "block" : "hidden lg:block"
            )}
          >
            {/* En-tête colonne — desktop */}
            <div className="mb-2 hidden items-center gap-2 px-1 lg:flex">
              <span className={cn("size-2 rounded-full", c.dot)} />
              <h2 className={cn("text-sm font-bold tracking-tight", c.accent)}>
                {c.title}
              </h2>
              {alertCount[c.key] > 0 && (
                <span className="bg-danger-100 text-danger-700 inline-flex animate-pulse items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums">
                  {alertCount[c.key]} à traiter
                </span>
              )}
              <span className="text-muted bg-surface-3 ml-auto rounded-full px-2 py-0.5 text-xs font-bold tabular-nums">
                {byColumn[c.key].length}
              </span>
            </div>

            <div className="space-y-2.5">
              {byColumn[c.key].length === 0 ? (
                <EmptyColumn icon={c.icon} />
              ) : (
                byColumn[c.key].map((o) => (
                  <OrderCard key={o.id} order={o} column={c.key} />
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function EmptyColumn({
  icon: Icon,
}: {
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="border-border text-subtle flex flex-col items-center justify-center gap-1.5 rounded-[14px] border border-dashed py-8">
      <Icon className="size-5" />
      <span className="text-xs">Rien ici</span>
    </div>
  );
}

/**
 * Minutes écoulées depuis `iso`. `null` AVANT le montage client : évite le
 * mismatch d'hydratation (le serveur n'a pas la même horloge que la tablette).
 */
function useElapsedMin(iso: string): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now === null
    ? null
    : Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

/**
 * Minutes SIGNÉES par rapport à `iso` : > 0 = `iso` est dépassé (en retard),
 * < 0 = encore à venir. `null` avant le montage client (anti-hydratation).
 * Sert à détecter une préparation qui dépasse l'heure « prête pour ».
 */
function useLateByMin(iso: string): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now === null
    ? null
    : Math.round((now - new Date(iso).getTime()) / 60_000);
}

/**
 * Formate une durée en minutes : « 45 min » sous une heure, « 1h05 » au-delà
 * (au-delà de 60 min de retard, on bascule en heures pour rester lisible).
 */
function fmtDur(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** Heure du créneau, fuseau Algérie figé → même rendu serveur ET client. */
function slotTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-DZ", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Algiers",
  });
}

/** Mappe le ton de phase livraison vers les tons du Badge du board. */
function phaseBadgeTone(
  tone: DeliveryPhaseTone
): "primary" | "success" | "warning" | "neutral" {
  if (tone === "amber") return "warning";
  if (tone === "violet") return "primary";
  if (tone === "success") return "success";
  if (tone === "primary") return "primary";
  return "neutral";
}

export function OrderCard({
  order,
  column,
}: {
  order: OrderWithItems;
  column: Column["key"];
}) {
  const ref = order.order_number ?? order.id.slice(0, 6).toUpperCase();
  const units = order.order_items.reduce((s, it) => {
    const q = Number(it.quantity || 0);
    // Une ligne au poids/volume compte pour 1 article.
    return s + (Number.isInteger(q) ? q : 1);
  }, 0);
  const itemsPreview = order.order_items
    .map((it) => it.product_name)
    .join(", ");
  const isDelivery = order.fulfillment_type === "delivery";
  // Phase de livraison en direct (livreur en route / récupérée / arrivé / livrée)
  // — affichée dans la colonne « Prêtes » pour ne plus laisser un simple « Prête ».
  const phase = isDelivery && column === "ready" ? deliveryPhase(order) : null;
  const hasNote = !!order.notes && order.notes !== "seed";
  const elapsed = useElapsedMin(order.created_at);
  // Retard de préparation : minutes au-delà de l'heure « prête pour ».
  const lateBy = useLateByMin(order.pickup_slot_at);

  // ── Niveaux d'attention (pour ne pas noyer le commerçant pendant le rush) ──
  //  warn  = bordure rouge (à surveiller)
  //  alert = carte qui CLIGNOTE (à traiter maintenant)
  let warn = false;
  let alert = false;
  if (column === "pending") {
    // À confirmer : auto-refus à 15 min → on alerte avant de la perdre.
    warn = elapsed !== null && elapsed >= 8;
    alert = elapsed !== null && elapsed >= 11;
  } else if (column === "preparing") {
    // En préparation : on a dépassé (ou on est à) l'heure de sortie prévue.
    warn = lateBy !== null && lateBy >= 0;
    alert = lateBy !== null && lateBy >= 1;
  }

  return (
    <div
      className={cn(
        "border-border bg-surface overflow-hidden rounded-[14px] border shadow-sm",
        warn && "border-danger-300 ring-danger-100 ring-2",
        alert && "animate-order-alert border-danger-400"
      )}
    >
      <Link
        href={`/orders/${order.id}`}
        className="hover:bg-surface-2 block px-3.5 pt-3 pb-2.5 transition-colors"
      >
        {/* Ligne 1 : #réf + total */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-primary-700 font-mono text-lg leading-none font-extrabold tracking-tight">
            #{ref}
          </span>
          <span className="text-foreground text-base font-bold tabular-nums">
            {formatDA(order.total_da)}
          </span>
        </div>

        {/* Ligne 2 : client + heure créneau */}
        <div className="text-muted mt-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="truncate font-medium">{order.customer_name}</span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <Clock className="size-3" />
            {slotTime(order.pickup_slot_at)}
          </span>
        </div>

        {/* Ligne 3 : articles */}
        <p className="text-foreground/80 mt-1.5 line-clamp-2 text-xs">
          <span className="font-semibold">{units} art.</span>{" "}
          <span className="text-muted">{itemsPreview}</span>
        </p>

        {/* Ligne 4 : badges */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {phase ? (
            <Badge tone={phaseBadgeTone(phase.tone)} icon={Bike}>
              {phase.short}
            </Badge>
          ) : (
            <Badge
              tone={isDelivery ? "primary" : "neutral"}
              icon={isDelivery ? Bike : Package}
            >
              {isDelivery ? "Livraison" : "Retrait"}
            </Badge>
          )}
          <Badge
            tone={order.payment_method === "online" ? "success" : "neutral"}
          >
            {order.payment_method === "online" ? "Payé en ligne" : "Espèces"}
          </Badge>
          {hasNote && (
            <Badge tone="warning" icon={StickyNote}>
              Note
            </Badge>
          )}
          {/* Indicateur temps/urgence — à droite des badges */}
          {column === "pending" && elapsed !== null && (
            <span
              className={cn(
                "ml-auto inline-flex items-center gap-1 text-[11px] font-bold tabular-nums",
                warn ? "text-danger-600" : "text-subtle"
              )}
            >
              {alert && (
                <span className="bg-danger-500 size-1.5 rounded-full" />
              )}
              il y a {fmtDur(elapsed)}
            </span>
          )}
          {column === "preparing" && lateBy !== null && (
            <span
              className={cn(
                "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                lateBy >= 1
                  ? "bg-danger-100 text-danger-700"
                  : lateBy >= 0
                    ? "bg-warning-100 text-warning-800"
                    : "text-subtle"
              )}
            >
              {lateBy >= 1
                ? `En retard ${fmtDur(lateBy)}`
                : lateBy >= 0
                  ? "À sortir"
                  : `Dans ${fmtDur(Math.abs(lateBy))}`}
            </span>
          )}
        </div>
      </Link>

      {/* Actions contextuelles */}
      <div className="border-border/70 border-t px-3 py-2.5">
        <CardActions order={order} column={column} />
      </div>
    </div>
  );
}

function Badge({
  children,
  tone,
  icon: Icon,
}: {
  children: React.ReactNode;
  tone: "primary" | "success" | "warning" | "neutral";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary-50 text-primary-700",
    success: "bg-success-50 text-success-700",
    warning: "bg-warning-50 text-warning-700",
    neutral: "bg-surface-3 text-muted",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        tones[tone]
      )}
    >
      {Icon && <Icon className="size-3" />}
      {children}
    </span>
  );
}

/** Boutons d'avancement selon la colonne. */
function CardActions({
  order,
  column,
}: {
  order: OrderWithItems;
  column: Column["key"];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [refusing, setRefusing] = useState(false);

  const move = (to: OrderWithItems["status"], note?: string, okMsg?: string) =>
    start(async () => {
      const res = await updateOrderStatus(order.id, to, undefined, note);
      if (res.error) {
        toast.error(res.error);
        // Board périmé (commande déjà annulée/avancée) → re-synchroniser pour
        // retirer la carte morte plutôt que de la laisser cliquable.
        if (res.stale) {
          setRefusing(false);
          router.refresh();
        }
        return;
      }
      toast.success(okMsg ?? "Mis à jour");
      setRefusing(false);
      router.refresh();
    });

  // Annulation DURCIE (mig 0117) : passe par merchant_cancel_order (refus si la
  // commande est déjà récupérée par le livreur, libère l'express, rembourse).
  const cancel = (reason: string) =>
    start(async () => {
      const res = await cancelOrderByMerchant(order.id, reason);
      if (res.error) {
        toast.error(res.error);
        if (res.stale) {
          setRefusing(false);
          router.refresh();
        }
        return;
      }
      toast.success("Commande annulée");
      setRefusing(false);
      router.refresh();
    });

  // Une fois la commande RÉCUPÉRÉE par le livreur, le commerçant ne peut plus
  // annuler (seul le flux livreur / super-admin agit).
  const pickedUp = !!order.delivery_picked_up_at;
  const canCancel = !pickedUp;

  // ─── Sélecteur de MOTIF d'annulation — partagé par toutes les colonnes ───
  if (refusing) {
    return (
      <div className="space-y-1">
        <p className="text-muted px-0.5 text-[11px] font-semibold tracking-wide uppercase">
          Motif de l&apos;annulation
        </p>
        <div className="grid grid-cols-1 gap-0.5">
          {REFUSAL_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => cancel(r)}
              disabled={pending}
              className="hover:bg-danger-50 text-foreground rounded-[8px] px-2 py-1.5 text-left text-xs disabled:opacity-50"
            >
              {r}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setRefusing(false)}
          className="text-muted w-full pt-0.5 text-center text-[11px] hover:underline"
        >
          Retour
        </button>
      </div>
    );
  }

  // Petit bouton « Annuler » secondaire (appel de confirmation client) — caché
  // dès que la commande est récupérée.
  const cancelLink = canCancel ? (
    <button
      type="button"
      onClick={() => setRefusing(true)}
      disabled={pending}
      className="text-danger-700 hover:bg-danger-50 mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-[10px] py-1.5 text-[12px] font-semibold disabled:opacity-50"
    >
      <X className="size-3.5" />
      Annuler (client injoignable)
    </button>
  ) : null;

  // ─── Colonne À CONFIRMER : Accepter / Refuser (motif) ───
  if (column === "pending") {
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => move("preparing", undefined, "Commande acceptée")}
          disabled={pending}
          className="bg-success-600 hover:bg-success-700 inline-flex flex-1 items-center justify-center gap-1 rounded-[10px] py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Accepter
        </button>
        <button
          type="button"
          onClick={() => setRefusing(true)}
          disabled={pending}
          className="border-danger-200 text-danger-700 hover:bg-danger-50 inline-flex items-center justify-center gap-1 rounded-[10px] border px-3 py-2 text-sm font-semibold disabled:opacity-50"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  // ─── Colonne EN PRÉPARATION : Marquer prête (+ annuler) ───
  if (column === "preparing") {
    return (
      <div>
        <button
          type="button"
          onClick={() => move("ready", undefined, "Commande prête")}
          disabled={pending}
          className="bg-primary-600 hover:bg-primary-700 inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Marquer prête
        </button>
        {cancelLink}
      </div>
    );
  }

  // ─── Colonne PRÊTES ───
  const isDelivery = order.fulfillment_type === "delivery";
  if (isDelivery) {
    // Phase en direct : « En attente d'un livreur » → « Livreur en route » →
    // « En livraison » → « Livreur arrivé ». La commande sort du board une fois
    // livrée (status=completed). Le commerçant suit la course sans rafraîchir.
    const phase = deliveryPhase(order);
    const isActive = phase != null && phase.key !== "awaiting_driver";
    return (
      <div>
        <p
          className={cn(
            "flex items-center gap-1.5 rounded-[10px] px-2.5 py-2 text-xs font-medium",
            isActive
              ? "text-primary-700 bg-primary-50"
              : "text-muted bg-surface-3"
          )}
        >
          <Bike className="size-3.5 shrink-0" />
          {phase?.label ?? "En attente d'un livreur"}
        </p>
        {/* Annuler tant que le livreur n'a PAS récupéré la commande. */}
        {cancelLink}
      </div>
    );
  }
  // Retrait espèces : confirmation directe. Retrait en ligne : code client.
  if (order.payment_method === "cash") {
    return (
      <div>
        <button
          type="button"
          onClick={() => move("completed", undefined, "Retrait confirmé")}
          disabled={pending}
          className="bg-success-600 hover:bg-success-700 inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Confirmer le retrait
        </button>
        {cancelLink}
      </div>
    );
  }
  return (
    <div>
      <Link
        href="/orders/validate"
        className="bg-primary-600 hover:bg-primary-700 inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] py-2 text-sm font-bold text-white"
      >
        <QrCode className="size-4" />
        Valider le code
      </Link>
      {cancelLink}
    </div>
  );
}
