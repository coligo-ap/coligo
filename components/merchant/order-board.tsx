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
import { updateOrderStatus } from "@/app/(merchant)/orders/actions";
import type { OrderWithItems } from "@/lib/types";

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

export function OrderBoard({ orders }: { orders: OrderWithItems[] }) {
  const [active, setActive] = useState<Column["key"]>("pending");

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
    // À confirmer : plus ancienne EN HAUT (urgence). Sinon plus récente en haut.
    map.pending.sort(
      (a, b) => +new Date(a.created_at) - +new Date(b.created_at)
    );
    return map;
  }, [orders]);

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
              "flex flex-col items-center gap-0.5 rounded-[12px] border px-2 py-2 text-xs font-semibold transition-colors",
              active === c.key
                ? "border-primary-600 bg-primary-50 text-primary-700"
                : "border-border text-muted bg-white"
            )}
          >
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

/** Minutes écoulées depuis `iso`, recalculées chaque minute. */
function useElapsedMin(iso: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

function slotTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-DZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OrderCard({
  order,
  column,
}: {
  order: OrderWithItems;
  column: Column["key"];
}) {
  const ref = order.order_number ?? order.id.slice(0, 6).toUpperCase();
  const units = order.order_items.reduce(
    (s, it) => s + Number(it.quantity || 0),
    0
  );
  const itemsPreview = order.order_items
    .map((it) => it.product_name)
    .join(", ");
  const isDelivery = order.fulfillment_type === "delivery";
  const hasNote = !!order.notes && order.notes !== "seed";
  const elapsed = useElapsedMin(order.created_at);
  // Urgence : commande à confirmer qui traîne (auto-refus à 15 min).
  const urgent = column === "pending" && elapsed >= 8;

  return (
    <div
      className={cn(
        "border-border bg-surface overflow-hidden rounded-[14px] border shadow-sm",
        urgent && "border-danger-300 ring-danger-100 ring-2"
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
          <Badge
            tone={isDelivery ? "primary" : "neutral"}
            icon={isDelivery ? Bike : Package}
          >
            {isDelivery ? "Livraison" : "Retrait"}
          </Badge>
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
          {column === "pending" && (
            <span
              className={cn(
                "ml-auto text-[11px] font-semibold tabular-nums",
                urgent ? "text-danger-600" : "text-subtle"
              )}
            >
              il y a {elapsed} min
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
        return;
      }
      toast.success(okMsg ?? "Mis à jour");
      setRefusing(false);
      router.refresh();
    });

  // ─── Colonne À CONFIRMER : Accepter / Refuser (motif) ───
  if (column === "pending") {
    if (refusing) {
      return (
        <div className="space-y-1">
          <p className="text-muted px-0.5 text-[11px] font-semibold tracking-wide uppercase">
            Motif du refus
          </p>
          <div className="grid grid-cols-1 gap-0.5">
            {REFUSAL_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => move("cancelled", r, "Commande refusée")}
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
            Annuler
          </button>
        </div>
      );
    }
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

  // ─── Colonne EN PRÉPARATION : Marquer prête ───
  if (column === "preparing") {
    return (
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
    );
  }

  // ─── Colonne PRÊTES ───
  const isDelivery = order.fulfillment_type === "delivery";
  if (isDelivery) {
    return (
      <p className="text-primary-700 bg-primary-50 flex items-center gap-1.5 rounded-[10px] px-2.5 py-2 text-xs font-medium">
        <Bike className="size-3.5 shrink-0" />
        En attente du livreur
      </p>
    );
  }
  // Retrait espèces : confirmation directe. Retrait en ligne : code client.
  if (order.payment_method === "cash") {
    return (
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
    );
  }
  return (
    <Link
      href="/orders/validate"
      className="bg-primary-600 hover:bg-primary-700 inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] py-2 text-sm font-bold text-white"
    >
      <QrCode className="size-4" />
      Valider le code
    </Link>
  );
}
