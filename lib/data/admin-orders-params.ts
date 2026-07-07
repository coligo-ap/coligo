import type { AdminOrderSearchFilters } from "@/lib/data/admin-orders";
import type { ExplorerFilters } from "@/components/admin/pilotage/admin-orders-explorer";

// =============================================================================
// searchParams URL → filtres de recherche commandes (partagé entre
// /admin/orders et /admin/merchants/commandes). Les dates de l'URL sont des
// JOURS Alger (UTC+1) convertis en bornes ISO UTC (fin exclusive J+1).
// =============================================================================

export const ORDERS_PAGE_SIZE = 30;

export type OrdersSearchParams = Record<string, string | string[] | undefined>;

function str(sp: OrdersSearchParams, key: string): string | undefined {
  const v = sp[key];
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** YYYY-MM-DD (jour Alger, UTC+1) → borne ISO UTC. `end` = borne exclusive J+1. */
function algiersDayToIso(day: string, end = false): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return undefined;
  const utc = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]) + (end ? 1 : 0)
  );
  return new Date(utc - 3600_000).toISOString();
}

export function buildSearchFilters(sp: OrdersSearchParams): {
  filters: AdminOrderSearchFilters;
  explorer: ExplorerFilters;
  page: number;
} {
  const page = Math.max(1, Number(str(sp, "page") ?? "1") || 1);
  const from = str(sp, "from");
  const to = str(sp, "to");
  const explorer: ExplorerFilters = {
    q: str(sp, "q"),
    mq: str(sp, "mq"),
    dq: str(sp, "dq"),
    st: str(sp, "st"),
    pm: str(sp, "pm"),
    ps: str(sp, "ps"),
    ft: str(sp, "ft"),
    dm: str(sp, "dm"),
    from,
    to,
    page,
  };
  const filters: AdminOrderSearchFilters = {
    q: explorer.q,
    merchantQ: explorer.mq,
    driverQ: explorer.dq,
    status: explorer.st,
    paymentMethod: explorer.pm as AdminOrderSearchFilters["paymentMethod"],
    paymentStatus: explorer.ps as AdminOrderSearchFilters["paymentStatus"],
    fulfillment: explorer.ft as AdminOrderSearchFilters["fulfillment"],
    deliveryMode: explorer.dm as AdminOrderSearchFilters["deliveryMode"],
    from: from ? algiersDayToIso(from) : undefined,
    to: to ? algiersDayToIso(to, true) : undefined,
    page,
    pageSize: ORDERS_PAGE_SIZE,
  };
  return { filters, explorer, page };
}
