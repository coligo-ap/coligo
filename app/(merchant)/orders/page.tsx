import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/session";
import {
  OrdersBrowser,
  type OrdersPeriod,
  type OrdersType,
} from "@/components/merchant/orders-browser";
import type { OrderStatus, OrderWithItems } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

const STATUS_FILTERS: Record<string, OrderStatus[]> = {
  pending: ["pending"],
  preparing: ["accepted", "preparing"],
  ready: ["ready"],
  completed: ["completed"],
  cancelled: ["cancelled"],
};

function parseStatusFilter(raw?: string): {
  key: string;
  statuses: OrderStatus[];
} {
  // Sans paramètre → « Toutes » : le commerçant voit TOUTES les commandes du
  // jour à l'ouverture (jamais un onglet vide parce qu'il n'y a rien « À
  // confirmer » alors qu'une commande est en préparation), puis affine.
  if (raw === undefined || raw === "all") return { key: "all", statuses: [] };
  const key = raw in STATUS_FILTERS ? raw : "all";
  return { key, statuses: STATUS_FILTERS[key] ?? [] };
}

function parsePage(raw?: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function parsePeriod(raw?: string): OrdersPeriod {
  // Défaut : AUJOURD'HUI — la page s'ouvre sur les commandes du jour
  // (opérationnel d'abord) ; « 7 jours » et « Personnalisé » pour l'historique.
  return raw === "7d" || raw === "custom" ? raw : "today";
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(raw?: string): string | null {
  return raw && DAY_RE.test(raw) ? raw : null;
}

function parseType(raw?: string): OrdersType {
  return raw === "delivery" || raw === "pickup" ? raw : "all";
}

/** Neutralise les caractères spéciaux PostgREST (ilike/or) avant recherche. */
function sanitizeSearch(raw?: string): string {
  return (raw ?? "")
    .replace(/[%_,()]/g, " ")
    .trim()
    .slice(0, 40);
}

/**
 * Bornes de la période. L'Algérie est en UTC+1 toute l'année (pas d'heure
 * d'été) → un jour Africa/Algiers = [minuit locale, minuit locale + 24 h[.
 */
function periodBounds(
  period: OrdersPeriod,
  from: string | null,
  to: string | null
): { start: string | null; end: string | null } {
  const now = Date.now();
  if (period === "7d")
    return { start: new Date(now - 7 * 86_400_000).toISOString(), end: null };
  if (period === "today") {
    const algiers = new Date(now + 3_600_000);
    algiers.setUTCHours(0, 0, 0, 0);
    return {
      start: new Date(algiers.getTime() - 3_600_000).toISOString(),
      end: null,
    };
  }
  // Personnalisé : bornes de jours choisies par le commerçant (l'une ou
  // l'autre peut manquer pendant la saisie → pas de borne de ce côté).
  return {
    start: from
      ? new Date(Date.parse(`${from}T00:00:00+01:00`)).toISOString()
      : null,
    end: to
      ? new Date(Date.parse(`${to}T00:00:00+01:00`) + 86_400_000).toISOString()
      : null,
  };
}

type SearchContext = {
  search: string;
  start: string | null;
  end: string | null;
  type: OrdersType;
};

/**
 * Applique le contexte de recherche (texte, période, type) à un builder orders.
 * Générique structurel : accepte la liste paginée ET les counts HEAD.
 */
function applyContext<
  Q extends {
    gte(col: string, v: string): Q;
    lt(col: string, v: string): Q;
    eq(col: string, v: string): Q;
    or(filters: string): Q;
  },
>(query: Q, ctx: SearchContext): Q {
  let q = query;
  if (ctx.start) q = q.gte("created_at", ctx.start);
  if (ctx.end) q = q.lt("created_at", ctx.end);
  if (ctx.type !== "all") q = q.eq("fulfillment_type", ctx.type);
  if (ctx.search) {
    // Recherche SERVEUR sur TOUT l'historique (pas seulement la page courante) :
    // nom client, téléphone ou n° de commande.
    q = q.or(
      `customer_name.ilike.%${ctx.search}%,customer_phone.ilike.%${ctx.search}%,order_number.ilike.%${ctx.search}%`
    );
  }
  return q;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    status?: string;
    q?: string;
    period?: string;
    type?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const {
    page: pageParam,
    status: statusParam,
    q: qParam,
    period: periodParam,
    type: typeParam,
    from: fromParam,
    to: toParam,
  } = await searchParams;
  const page = parsePage(pageParam);
  const filter = parseStatusFilter(statusParam);
  const period = parsePeriod(periodParam);
  const type = parseType(typeParam);
  const search = sanitizeSearch(qParam);
  const from = period === "custom" ? parseDay(fromParam) : null;
  const to = period === "custom" ? parseDay(toParam) : null;
  const bounds = periodBounds(period, from, to);
  const ctx: SearchContext = {
    search,
    start: bounds.start,
    end: bounds.end,
    type,
  };

  const supabase = await createClient();

  // Scope EXPLICITE sur le commerçant connecté (en plus de la RLS) — règle
  // projet : toute requête commerçant porte son .eq('merchant_id').
  const user = await getAuthUser();
  const { data: me } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();
  const merchantId = me?.id ?? "";

  // Query orders : pagination ranges + count exact pour calculer le nombre
  // de pages.
  let query = applyContext(
    supabase
      .from("orders")
      .select(
        `id, merchant_id, customer_name, customer_phone, status,
       total_da, service_fee_da, cashback_da, commission_da,
       pickup_code, order_number, pickup_slot_at, notes, created_at,
       payment_method, payment_status,
       fulfillment_type, delivery_mode,
       delivery_address_text, delivery_phone, delivery_note,
       delivery_driver_id, delivery_picked_up_at, delivery_arrived_at,
       delivery_delivered_at,
       order_items ( id, order_id, product_name, unit_price_da, quantity, line_total_da )`,
        { count: "exact" }
      )
      .eq("merchant_id", merchantId),
    ctx
  ).order("created_at", { ascending: false });

  if (filter.statuses.length > 0) {
    query = query.in("status", filter.statuses);
  }

  const offset = (page - 1) * PAGE_SIZE;
  // La liste paginée et les compteurs par statut (onglets de filtre) sont
  // INDÉPENDANTS → en PARALLÈLE plutôt qu'en cascade (un aller-retour de moins).
  const [ordersRes, statusCounts] = await Promise.all([
    query.range(offset, offset + PAGE_SIZE - 1),
    fetchStatusCounts(supabase, merchantId, ctx),
  ]);
  const { data: orders, count, error } = ordersRes;

  if (error) {
    return (
      <div className="p-4 lg:p-6">
        <div className="rounded-control border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Erreur de chargement des commandes : {error.message}
        </div>
      </div>
    );
  }

  // Anti-fraude prompt 9 : masquer pickup_code pour les livraisons.
  const ordersList = (
    (orders ?? []) as unknown as (OrderWithItems & {
      fulfillment_type?: string;
    })[]
  ).map((o) =>
    o.fulfillment_type === "delivery"
      ? ({ ...o, pickup_code: "" } as OrderWithItems)
      : (o as OrderWithItems)
  );
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <OrdersBrowser
      orders={ordersList}
      page={page}
      pageCount={pageCount}
      total={total}
      filter={filter.key}
      statusCounts={statusCounts}
      q={search}
      period={period}
      type={type}
      from={from ?? ""}
      to={to ?? ""}
    />
  );
}

type StatusCounts = {
  all: number;
  pending: number;
  preparing: number;
  ready: number;
  completed: number;
  cancelled: number;
};

async function fetchStatusCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  merchantId: string,
  ctx: SearchContext
): Promise<StatusCounts> {
  // 6 requêtes HEAD count (très légères, RLS appliquée), lancées en parallèle.
  // Elles portent le MÊME contexte (recherche/période/type) que la liste → les
  // compteurs des onglets collent toujours à ce que le commerçant regarde.
  const head = () =>
    applyContext(
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("merchant_id", merchantId),
      ctx
    );
  const [all, pending, preparing, ready, completed, cancelled] =
    await Promise.all([
      head(),
      head().eq("status", "pending"),
      head().in("status", ["accepted", "preparing"]),
      head().eq("status", "ready"),
      head().eq("status", "completed"),
      head().eq("status", "cancelled"),
    ]);
  return {
    all: all.count ?? 0,
    pending: pending.count ?? 0,
    preparing: preparing.count ?? 0,
    ready: ready.count ?? 0,
    completed: completed.count ?? 0,
    cancelled: cancelled.count ?? 0,
  };
}
