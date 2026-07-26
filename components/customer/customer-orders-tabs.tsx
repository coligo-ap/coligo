"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Banknote,
  Bike,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Hourglass,
  Package,
  Search,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS_META, type OrderStatus } from "@/lib/types";
import { cn, formatDA } from "@/lib/utils";
import { cldUrl } from "@/lib/images/cloudinary";
import { OrderReviewCta } from "@/components/customer/order-review-cta";

export type CustomerOrderRow = {
  id: string;
  status: OrderStatus;
  payment_method: "cash" | "online";
  payment_status: "pending" | "paid" | "failed" | "refunded";
  total_da: number;
  pickup_code: string;
  order_number: string | null;
  created_at: string;
  fulfillment_type: "pickup" | "delivery";
  merchant_name: string;
  merchant_logo: string | null;
  reviewed: boolean;
};

type TabKey = "ongoing" | "done" | "cancelled";
type TypeKey = "all" | "delivery" | "pickup";

const ONGOING: OrderStatus[] = ["pending", "accepted", "preparing", "ready"];

// Clé i18n du libellé de badge par statut (la COULEUR vient de ORDER_STATUS_META).
const STATUS_BADGE_KEY: Record<OrderStatus, string> = {
  pending: "badgePending",
  accepted: "badgeAccepted",
  preparing: "badgePreparing",
  ready: "badgeReady",
  completed: "badgeCompleted",
  cancelled: "badgeCancelled",
};

function tabOf(status: OrderStatus): TabKey {
  if (status === "completed") return "done";
  if (status === "cancelled") return "cancelled";
  return "ongoing";
}

/**
 * Liste « Mes commandes » style Bolt Food : segmented control (En cours /
 * Terminées / Annulées) + recherche (commerce, n°) + filtre Livraison / Retrait.
 * TOUT est côté client (les données sont déjà chargées par TanStack Query) —
 * zéro round-trip serveur, réponse instantanée à chaque tap (règle produit).
 */
export function CustomerOrdersTabs({ orders }: { orders: CustomerOrderRow[] }) {
  const t = useTranslations("orders");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeKey>("all");

  // La recherche et le type s'appliquent AVANT le comptage des onglets → les
  // compteurs collent toujours à ce que l'utilisateur regarde.
  const scoped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (type !== "all" && o.fulfillment_type !== type) return false;
      if (!needle) return true;
      return (
        o.merchant_name.toLowerCase().includes(needle) ||
        (o.order_number ?? "").toLowerCase().includes(needle)
      );
    });
  }, [orders, query, type]);

  const counts = useMemo(() => {
    const c = { ongoing: 0, done: 0, cancelled: 0 };
    for (const o of scoped) c[tabOf(o.status)]++;
    return c;
  }, [scoped]);

  // Onglet par défaut : « En cours » s'il y en a, sinon « Terminées ».
  const [tab, setTab] = useState<TabKey>(
    orders.some((o) => tabOf(o.status) === "ongoing")
      ? "ongoing"
      : orders.some((o) => tabOf(o.status) === "done")
        ? "done"
        : "cancelled"
  );

  const filtered = scoped.filter((o) => tabOf(o.status) === tab);

  const tabs: { key: TabKey; label: string; n: number }[] = [
    { key: "ongoing", label: t("tabOngoing"), n: counts.ongoing },
    { key: "done", label: t("tabDone"), n: counts.done },
    { key: "cancelled", label: t("tabCancelled"), n: counts.cancelled },
  ];

  // Chips BASCULE (pas de « Tous ») : aucune active = tout est affiché ;
  // re-taper la chip active la désélectionne.
  const types: {
    key: Exclude<TypeKey, "all">;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { key: "delivery", label: t("delivery"), icon: Bike },
    { key: "pickup", label: t("pickup"), icon: Package },
  ];

  return (
    <div>
      {/* Segmented control — style Bolt */}
      <div className="bg-surface-3 mb-3 flex gap-1 rounded-full p-1">
        {tabs.map((tb) => {
          const active = tab === tb.key;
          return (
            <button
              key={tb.key}
              type="button"
              onClick={() => setTab(tb.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-bold transition",
                active
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted hover:text-foreground"
              )}
            >
              {tb.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] font-bold tabular-nums",
                  active
                    ? "bg-primary-100 text-primary-700"
                    : "bg-surface-2 text-subtle"
                )}
              >
                {tb.n}
              </span>
            </button>
          );
        })}
      </div>

      {/* Recherche + filtre type — filtrage instantané, zéro serveur */}
      <div className="mb-4 space-y-2">
        <div className="relative">
          <Search className="text-subtle absolute start-3 top-1/2 size-4 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="border-border bg-surface focus:border-primary-500 focus:ring-primary-100 h-11 w-full rounded-[13px] border ps-9 pe-10 text-sm outline-none focus:ring-2"
          />
          {query && (
            <button
              type="button"
              aria-label={t("clearSearch")}
              onClick={() => setQuery("")}
              className="text-subtle hover:text-foreground absolute end-2.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {types.map((tp) => {
            const TypeIcon = tp.icon;
            const active = type === tp.key;
            return (
              <button
                key={tp.key}
                type="button"
                onClick={() => setType(active ? "all" : tp.key)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors",
                  active
                    ? "border-primary-600 bg-primary-50 text-primary-700"
                    : "border-border bg-surface text-muted hover:bg-surface-2"
                )}
              >
                <TypeIcon className="size-3.5" />
                {tp.label}
                {active && <X className="size-3" />}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="border-border bg-surface text-muted rounded-[14px] border p-8 text-center text-sm">
          <ClipboardList className="text-subtle mx-auto mb-2 size-7" />
          {t("emptyCategory")}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderCard({ order: o }: { order: CustomerOrderRow }) {
  const t = useTranslations("orders");
  const meta = ORDER_STATUS_META[o.status];
  const ongoing = ONGOING.includes(o.status);
  const date = new Date(o.created_at).toLocaleDateString("fr-DZ", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    // timeZone fixe → pas de mismatch d'hydratation (#418).
    timeZone: "Africa/Algiers",
  });

  return (
    <li>
      <Link
        href={`/commandes/${o.id}`}
        className={cn(
          "bg-surface flex items-center gap-3 rounded-[16px] border p-3 transition",
          // Commande EN COURS = carte mise en avant (suivi en un tap).
          ongoing
            ? "border-primary-200 ring-primary-100 hover:border-primary-300 ring-2"
            : "border-border hover:border-primary-300"
        )}
      >
        {o.merchant_logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={
              cldUrl(o.merchant_logo, {
                width: 96,
                height: 96,
                crop: "fill",
                gravity: "auto",
              }) ?? o.merchant_logo
            }
            alt=""
            loading="lazy"
            decoding="async"
            className="border-border size-12 shrink-0 self-start rounded-full border bg-white object-cover"
          />
        ) : (
          <div className="bg-primary-100 text-primary-700 flex size-12 shrink-0 items-center justify-center self-start rounded-full text-base font-bold">
            {o.merchant_name.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {/* Ligne 1 : nom du commerce + montant */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-foreground line-clamp-1 text-sm font-semibold">
              {o.merchant_name}
            </p>
            <span className="text-foreground shrink-0 text-sm font-bold tabular-nums">
              {formatDA(o.total_da)}
            </span>
          </div>
          {/* Ligne 2 : statut (point vivant si en cours) + date · type · n° + paiement */}
          <div className="text-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <Badge tone={meta.tone}>
              {ongoing && (
                <span className="me-1 inline-block size-1.5 animate-pulse rounded-full bg-current" />
              )}
              {t(STATUS_BADGE_KEY[o.status])}
            </Badge>
            <span>{date}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              {o.fulfillment_type === "delivery" ? (
                <Bike className="size-3" />
              ) : (
                <Package className="size-3" />
              )}
              {o.fulfillment_type === "delivery" ? t("delivery") : t("pickup")}
            </span>
            {o.order_number && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {t("orderNumberShort")} {o.order_number}
                </span>
              </>
            )}
            <PaymentBadge method={o.payment_method} status={o.payment_status} />
          </div>
          {o.status === "completed" && !o.reviewed && (
            <div className="mt-1.5">
              <OrderReviewCta orderId={o.id} merchantName={o.merchant_name} />
            </div>
          )}
        </div>
        <ChevronRight className="text-subtle size-4 shrink-0 rtl:-scale-x-100" />
      </Link>
    </li>
  );
}

function PaymentBadge({
  method,
  status,
}: {
  method: "cash" | "online";
  status: "pending" | "paid" | "failed" | "refunded";
}) {
  const t = useTranslations("orders");
  if (method === "cash") {
    return (
      <span className="text-muted inline-flex items-center gap-1 text-[11px]">
        <Banknote className="size-3" />
        {t("payCash")}
      </span>
    );
  }
  if (status === "paid") {
    return (
      <span className="text-success-700 inline-flex items-center gap-1 text-[11px] font-semibold">
        <CreditCard className="size-3" />
        {t("payPaidOnline")}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="text-danger-700 inline-flex items-center gap-1 text-[11px] font-semibold">
        <CreditCard className="size-3" />
        {t("payFailed")}
      </span>
    );
  }
  if (status === "refunded") {
    return (
      <span className="text-muted inline-flex items-center gap-1 text-[11px] font-medium">
        <CreditCard className="size-3" />
        {t("payRefunded")}
      </span>
    );
  }
  return (
    <span className="text-warning-700 inline-flex items-center gap-1 text-[11px] font-semibold">
      <Hourglass className="size-3" />
      {t("payPending")}
    </span>
  );
}
