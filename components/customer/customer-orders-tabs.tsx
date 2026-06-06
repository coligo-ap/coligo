"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Banknote, ClipboardList, CreditCard, Hourglass } from "lucide-react";
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

export function CustomerOrdersTabs({ orders }: { orders: CustomerOrderRow[] }) {
  const t = useTranslations("orders");
  const counts = useMemo(() => {
    const c = { ongoing: 0, done: 0, cancelled: 0 };
    for (const o of orders) c[tabOf(o.status)]++;
    return c;
  }, [orders]);

  // Onglet par défaut : « En cours » s'il y en a, sinon « Terminées ».
  const [tab, setTab] = useState<TabKey>(
    counts.ongoing > 0 ? "ongoing" : counts.done > 0 ? "done" : "cancelled"
  );

  const filtered = orders.filter((o) => tabOf(o.status) === tab);

  const tabs: { key: TabKey; label: string; n: number }[] = [
    { key: "ongoing", label: t("tabOngoing"), n: counts.ongoing },
    { key: "done", label: t("tabDone"), n: counts.done },
    { key: "cancelled", label: t("tabCancelled"), n: counts.cancelled },
  ];

  return (
    <div>
      {/* Onglets de statut */}
      <div className="border-border mb-4 flex gap-1 overflow-x-auto border-b">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "relative -mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition",
                active
                  ? "border-primary-600 text-primary-700"
                  : "text-muted hover:text-foreground border-transparent"
              )}
            >
              {t.label}
              <span
                className={cn(
                  "ms-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
                  active
                    ? "bg-primary-100 text-primary-700"
                    : "bg-surface-3 text-muted"
                )}
              >
                {t.n}
              </span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="border-border bg-surface text-muted rounded-[14px] border p-8 text-center text-sm">
          <ClipboardList className="text-subtle mx-auto mb-2 size-7" />
          {t("emptyCategory")}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((o) => {
            const meta = ORDER_STATUS_META[o.status];
            const date = new Date(o.created_at).toLocaleDateString("fr-DZ", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <li key={o.id}>
                <Link
                  href={`/commandes/${o.id}`}
                  className="border-border bg-surface hover:border-primary-300 flex items-center gap-3 rounded-[14px] border p-3 transition"
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
                      className="border-border size-11 shrink-0 self-start rounded-full border bg-white object-cover"
                    />
                  ) : (
                    <div className="bg-primary-100 text-primary-700 flex size-11 shrink-0 items-center justify-center self-start rounded-full text-base font-bold">
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
                    {/* Ligne 2 : statut + date · type · n° + paiement (s'enroule) */}
                    <div className="text-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <Badge tone={meta.tone}>
                        {t(STATUS_BADGE_KEY[o.status])}
                      </Badge>
                      <span>{date}</span>
                      <span aria-hidden>·</span>
                      <span>
                        {o.fulfillment_type === "delivery"
                          ? t("delivery")
                          : t("pickup")}
                      </span>
                      {o.order_number && (
                        <>
                          <span aria-hidden>·</span>
                          <span>
                            {t("orderNumberShort")} {o.order_number}
                          </span>
                        </>
                      )}
                      <PaymentBadge
                        method={o.payment_method}
                        status={o.payment_status}
                      />
                    </div>
                    {o.status === "completed" && !o.reviewed && (
                      <div className="mt-1.5">
                        <OrderReviewCta
                          orderId={o.id}
                          merchantName={o.merchant_name}
                        />
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
