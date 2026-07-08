import type { AdminRideSearchFilters } from "@/lib/data/admin-rides";

// =============================================================================
// searchParams URL → filtres de recherche courses Drive (onglet Courses du hub
// Coligo Drive). Dates = JOURS Alger (UTC+1) → bornes ISO UTC (fin exclusive).
// Même mécanique que lib/data/admin-orders-params.ts.
// =============================================================================

export const RIDES_PAGE_SIZE = 30;

export type RidesSearchParams = Record<string, string | string[] | undefined>;

export type RidesExplorerFilters = {
  q?: string;
  cq?: string;
  st?: string;
  pm?: string;
  from?: string;
  to?: string;
  page?: number;
};

function str(sp: RidesSearchParams, key: string): string | undefined {
  const v = sp[key];
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

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

export function buildRideFilters(sp: RidesSearchParams): {
  filters: AdminRideSearchFilters;
  explorer: RidesExplorerFilters;
  page: number;
} {
  const page = Math.max(1, Number(str(sp, "page") ?? "1") || 1);
  const from = str(sp, "from");
  const to = str(sp, "to");
  const explorer: RidesExplorerFilters = {
    q: str(sp, "q"),
    cq: str(sp, "cq"),
    st: str(sp, "st"),
    pm: str(sp, "pm"),
    from,
    to,
    page,
  };
  const filters: AdminRideSearchFilters = {
    q: explorer.q,
    chauffeurQ: explorer.cq,
    status: explorer.st,
    payment: explorer.pm as AdminRideSearchFilters["payment"],
    from: from ? algiersDayToIso(from) : undefined,
    to: to ? algiersDayToIso(to, true) : undefined,
    page,
    pageSize: RIDES_PAGE_SIZE,
  };
  return { filters, explorer, page };
}
