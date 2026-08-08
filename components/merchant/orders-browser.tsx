"use client";

/**
 * Page COMMANDES = recherche + filtres + historique complet (consultation).
 * Complément du board live du dashboard : ici on retrouve TOUTES les commandes
 * (y compris récupérées / annulées), on cherche par nom / n° / téléphone sur
 * TOUT l'historique (recherche serveur, pas seulement la page affichée), on
 * filtre par période et par type (livraison / retrait), et on ouvre le détail.
 * Les actions d'avancement se font sur le board ou le détail.
 *
 * Interaction type Bolt Food : la saisie filtre INSTANTANÉMENT la page affichée
 * (zéro attente), puis la recherche serveur (debounce 400 ms) ramène l'
 * historique complet correspondant.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  Bike,
  ChevronRight,
  Clock,
  CreditCard,
  Loader2,
  Package,
  Search,
  X,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import {
  ORDER_STATUS_META,
  type OrderStatus,
  type OrderWithItems,
} from "@/lib/types";
import { Pagination } from "@/components/ui/pagination";

export type OrdersPeriod = "today" | "7d" | "custom";
export type OrdersType = "all" | "delivery" | "pickup";

type StatusCounts = {
  all: number;
  pending: number;
  preparing: number;
  ready: number;
  completed: number;
  cancelled: number;
};

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Toutes" },
  { key: "pending", label: "À confirmer" },
  { key: "preparing", label: "En préparation" },
  { key: "ready", label: "Prêtes" },
  { key: "completed", label: "Récupérées" },
  { key: "cancelled", label: "Annulées" },
];

const PERIODS: { key: OrdersPeriod; label: string }[] = [
  { key: "today", label: "Aujourd'hui" },
  { key: "7d", label: "7 jours" },
  { key: "custom", label: "Personnalisé" },
];

// Chips BASCULE (pas de « Tous ») : aucune active = les deux types affichés ;
// re-taper la chip active la désélectionne.
const TYPES: {
  key: Exclude<OrdersType, "all">;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "delivery", label: "Livraison", icon: Bike },
  { key: "pickup", label: "Retrait", icon: Package },
];

const TONE_CLASSES: Record<string, string> = {
  amber: "bg-warning-50 text-warning-700",
  teal: "bg-primary-50 text-primary-700",
  green: "bg-success-50 text-success-700",
  stone: "bg-surface-3 text-muted",
  rose: "bg-danger-50 text-danger-700",
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-DZ", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Algiers",
  });
}

/** Clé de jour (fuseau Algérie figé) pour grouper l'historique par date. */
function dayKey(ms: number): string {
  return new Date(ms).toLocaleDateString("fr-DZ", {
    timeZone: "Africa/Algiers",
  });
}

function dayLabel(iso: string): string {
  const key = dayKey(new Date(iso).getTime());
  if (key === dayKey(Date.now())) return "Aujourd'hui";
  if (key === dayKey(Date.now() - 86_400_000)) return "Hier";
  return new Date(iso).toLocaleDateString("fr-DZ", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Africa/Algiers",
  });
}

export function OrdersBrowser({
  orders,
  page,
  pageCount,
  total,
  filter,
  statusCounts,
  q,
  period,
  type,
  from,
  to,
}: {
  orders: OrderWithItems[];
  page: number;
  pageCount: number;
  total: number;
  filter: string;
  statusCounts: StatusCounts;
  q: string;
  period: OrdersPeriod;
  type: OrdersType;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [input, setInput] = useState(q);
  const [searching, startSearch] = useTransition();
  // Réf stable de la dernière recherche POUSSÉE au serveur — évite de re-push
  // la même valeur quand le RSC revient (et l'effet re-tourne).
  const pushedQ = useRef(q);

  const hrefFor = (over: {
    status?: string;
    page?: number;
    q?: string;
    period?: OrdersPeriod;
    type?: OrdersType;
    from?: string;
    to?: string;
  }): string => {
    const p = new URLSearchParams();
    // `status` TOUJOURS présent : sans paramètre le serveur ouvre « À
    // confirmer » (défaut), on ne veut pas perdre l'onglet courant.
    p.set("status", over.status ?? filter);
    const qq = over.q !== undefined ? over.q : q;
    if (qq) p.set("q", qq);
    const pe = over.period ?? period;
    if (pe !== "today") p.set("period", pe);
    // Les bornes de dates n'ont de sens qu'en période personnalisée.
    if (pe === "custom") {
      const df = over.from !== undefined ? over.from : from;
      const dt = over.to !== undefined ? over.to : to;
      if (df) p.set("from", df);
      if (dt) p.set("to", dt);
    }
    const ty = over.type ?? type;
    if (ty !== "all") p.set("type", ty);
    const pg = over.page ?? 1;
    if (pg > 1) p.set("page", String(pg));
    return `/orders?${p.toString()}`;
  };

  // Recherche SERVEUR débouncée : replace (pas de nouvelle entrée d'historique
  // navigateur à chaque frappe) + transition (l'input reste fluide).
  useEffect(() => {
    const clean = input.trim().slice(0, 40);
    if (clean === pushedQ.current) return;
    const t = setTimeout(() => {
      pushedQ.current = clean;
      startSearch(() => {
        router.replace(hrefFor({ q: clean, page: 1 }), { scroll: false });
      });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const countFor = (key: string): number =>
    key === "all"
      ? statusCounts.all
      : (statusCounts[key as keyof StatusCounts] ?? 0);

  // Filtre client INSTANTANÉ sur la page affichée pendant que la recherche
  // serveur (historique complet) arrive.
  const filtered = useMemo(() => {
    const needle = input.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((o) => {
      const ref = (o.order_number ?? o.id.slice(0, 6)).toLowerCase();
      return (
        o.customer_name.toLowerCase().includes(needle) ||
        ref.includes(needle) ||
        (o.customer_phone ?? "").toLowerCase().includes(needle)
      );
    });
  }, [orders, input]);

  // Groupes par jour (la liste arrive déjà triée du plus récent au plus ancien).
  const groups = useMemo(() => {
    const out: { label: string; items: OrderWithItems[] }[] = [];
    for (const o of filtered) {
      const label = dayLabel(o.created_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(o);
      else out.push({ label, items: [o] });
    }
    return out;
  }, [filtered]);

  return (
    <div className="mx-auto max-w-[900px] p-4 lg:p-6 lg:px-8">
      <header className="mb-4 flex items-end justify-between gap-2">
        <div>
          <p className="text-muted text-xs font-medium">Historique</p>
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
            Commandes
          </h1>
        </div>
        <p className="text-muted pb-1 text-xs font-semibold tabular-nums">
          {total} commande{total > 1 ? "s" : ""}
        </p>
      </header>

      {/* Recherche — serveur, sur tout l'historique */}
      <div className="relative mb-3">
        <Search className="text-subtle absolute start-3 top-1/2 size-4 -translate-y-1/2" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Rechercher (nom, n°, téléphone)…"
          className="border-border bg-surface focus:border-primary-500 focus:ring-primary-100 h-11 w-full rounded-md border ps-9 pe-10 text-sm outline-none focus:ring-2"
        />
        {searching ? (
          <Loader2 className="text-subtle absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin" />
        ) : (
          input && (
            <button
              type="button"
              aria-label="Effacer la recherche"
              onClick={() => setInput("")}
              className="text-subtle hover:text-foreground absolute end-2.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full"
            >
              <X className="size-4" />
            </button>
          )
        )}
      </div>

      {/* Filtres par statut (liens serveur, conservent recherche + période) */}
      <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => {
          const activeChip = filter === f.key;
          return (
            <Link
              key={f.key}
              href={hrefFor({ status: f.key })}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                activeChip
                  ? "border-primary-600 bg-primary-600 text-white"
                  : "border-border text-muted hover:bg-surface-2 bg-white"
              )}
            >
              {f.label}
              <span
                className={cn(
                  "text-micro rounded-full px-1.5 tabular-nums",
                  activeChip ? "bg-white/20" : "bg-surface-3 text-subtle"
                )}
              >
                {countFor(f.key)}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Période + type — deuxième rangée compacte */}
      <div className="mb-4 flex items-center gap-1.5 overflow-x-auto pb-1">
        <div className="border-border flex shrink-0 gap-0.5 rounded-full border bg-white p-0.5">
          {PERIODS.map((pOpt) => (
            <Link
              key={pOpt.key}
              // Passage en « Personnalisé » ⇒ statut « Toutes » d'office :
              // le commerçant part de TOUT l'historique de la plage choisie,
              // puis affine (statut, recherche) — pas de résultat vide parce
              // qu'on était resté sur « À confirmer ».
              href={hrefFor({
                period: pOpt.key,
                ...(pOpt.key === "custom" && period !== "custom"
                  ? { status: "all" }
                  : {}),
              })}
              className={cn(
                "text-caption rounded-full px-2.5 py-1 font-bold whitespace-nowrap transition-colors",
                period === pOpt.key
                  ? "bg-primary-600 text-white"
                  : "text-muted hover:bg-surface-2"
              )}
            >
              {pOpt.label}
            </Link>
          ))}
        </div>
        <span className="bg-border h-5 w-px shrink-0" />
        {TYPES.map((tOpt) => {
          const TypeIcon = tOpt.icon;
          const activeType = type === tOpt.key;
          return (
            <Link
              key={tOpt.key}
              // BASCULE : re-taper la chip active revient à « tous les types ».
              href={hrefFor({ type: activeType ? "all" : tOpt.key })}
              className={cn(
                "text-caption inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 font-bold whitespace-nowrap transition-colors",
                activeType
                  ? "border-primary-600 bg-primary-50 text-primary-700"
                  : "border-border text-muted hover:bg-surface-2 bg-white"
              )}
            >
              <TypeIcon className="size-3" />
              {tOpt.label}
              {activeType && <X className="size-3" />}
            </Link>
          );
        })}
      </div>

      {/* Plage personnalisée : deux bornes de jour, appliquées dès la saisie. */}
      {period === "custom" && (
        <div className="mb-4 flex items-center gap-2">
          <DayInput
            label="Du"
            value={from}
            max={to || undefined}
            onChange={(v) =>
              startSearch(() => {
                router.replace(hrefFor({ from: v, page: 1 }), {
                  scroll: false,
                });
              })
            }
          />
          <DayInput
            label="Au"
            value={to}
            min={from || undefined}
            onChange={(v) =>
              startSearch(() => {
                router.replace(hrefFor({ to: v, page: 1 }), { scroll: false });
              })
            }
          />
        </div>
      )}

      {/* Liste groupée par jour */}
      {filtered.length === 0 ? (
        <div className="border-border text-subtle flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16">
          <Package className="size-6" />
          <p className="text-sm">
            {input.trim() || type !== "all" || period === "custom"
              ? "Aucune commande ne correspond à ces filtres"
              : "Aucune commande sur cette période"}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.label}>
              <h2
                suppressHydrationWarning
                className="text-muted text-caption mb-1.5 px-1 font-bold tracking-wide uppercase"
              >
                {g.label}
              </h2>
              <ul className="space-y-2">
                {g.items.map((o) => (
                  <OrderRow key={o.id} order={o} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <div className="mt-5">
        <Pagination
          page={page}
          pageCount={pageCount}
          total={total}
          itemLabel={{ singular: "commande", plural: "commandes" }}
          hrefFor={(p) => hrefFor({ page: p })}
        />
      </div>
    </div>
  );
}

function OrderRow({ order: o }: { order: OrderWithItems }) {
  const ref = o.order_number ?? o.id.slice(0, 6).toUpperCase();
  const meta = ORDER_STATUS_META[o.status as OrderStatus];
  const units = o.order_items.reduce((s, it) => {
    const qty = Number(it.quantity || 0);
    return s + (Number.isInteger(qty) ? qty : 1);
  }, 0);
  const itemsPreview = o.order_items.map((it) => it.product_name).join(", ");
  const isDelivery = o.fulfillment_type === "delivery";
  const paidOnline = o.payment_method === "online";

  return (
    <li>
      <Link
        href={`/orders/${o.id}`}
        className="border-border bg-surface hover:bg-surface-2 rounded-card-lg flex items-center gap-3 border px-3.5 py-3 transition-colors"
      >
        <div className="min-w-0 flex-1">
          {/* Ligne 1 : réf + statut + type — total à droite */}
          <div className="flex items-center gap-2">
            <span className="text-primary-700 font-mono text-sm font-extrabold">
              #{ref}
            </span>
            <span
              className={cn(
                "text-micro rounded-full px-2 py-0.5 font-semibold",
                TONE_CLASSES[meta.tone]
              )}
            >
              {meta.label}
            </span>
            {isDelivery ? (
              <Bike className="text-subtle size-3.5" />
            ) : (
              <Package className="text-subtle size-3.5" />
            )}
          </div>
          {/* Ligne 2 : contenu de la commande */}
          <p className="text-muted mt-1 line-clamp-1 text-xs">
            <span className="text-foreground/80 font-semibold">
              {units} art.
            </span>{" "}
            {itemsPreview}
          </p>
          {/* Ligne 3 : client · heure · paiement */}
          <div className="text-muted mt-1 flex items-center gap-2 text-xs">
            <span className="truncate font-medium">{o.customer_name}</span>
            <span className="text-subtle">·</span>
            <span className="inline-flex shrink-0 items-center gap-1">
              <Clock className="size-3" />
              {fmtTime(o.created_at)}
            </span>
            <span className="text-subtle">·</span>
            <span
              className={cn(
                "text-caption inline-flex shrink-0 items-center gap-1 font-semibold",
                paidOnline ? "text-success-700" : "text-muted"
              )}
            >
              {paidOnline ? (
                <CreditCard className="size-3" />
              ) : (
                <Banknote className="size-3" />
              )}
              {paidOnline ? "Payé en ligne" : "Espèces"}
            </span>
          </div>
        </div>
        <div className="text-end">
          <div className="text-foreground text-sm font-bold tabular-nums">
            {formatDA(o.total_da)}
          </div>
        </div>
        <ChevronRight className="text-subtle size-4 shrink-0 rtl:-scale-x-100" />
      </Link>
    </li>
  );
}

/** Borne de jour (période personnalisée) — input date natif, libellé intégré. */
function DayInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="border-border bg-surface focus-within:border-primary-500 flex h-10 flex-1 items-center gap-2 rounded-md border px-3">
      <span className="text-muted text-caption shrink-0 font-bold">
        {label}
      </span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="text-foreground w-full min-w-0 bg-transparent text-sm font-semibold outline-none"
      />
    </label>
  );
}
