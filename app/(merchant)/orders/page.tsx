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
  // Sans paramètre → on ouvre directement sur « À confirmer » : ce sont les
  // commandes qui demandent une action immédiate du commerçant.
  if (raw === undefined)
    return { key: "pending", statuses: STATUS_FILTERS.pending };
  // « Toutes » (status=all) reste explicitement disponible via son onglet.
  if (raw === "all") return { key: "all", statuses: [] };
  const key = raw in STATUS_FILTERS ? raw : "all";
  return { key, statuses: STATUS_FILTERS[key] ?? [] };
}

function parsePage(raw?: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function parsePeriod(raw?: string): OrdersPeriod {
  return raw === "today" || raw === "7d" || raw === "30d" ? raw : "all";
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
 * Borne basse de la période. L'Algérie est en UTC+1 toute l'année (pas d'heure
 * d'été) → « aujourd'hui » = minuit Africa/Algiers calculé sans dépendance.
 */
function periodStart(period: OrdersPeriod): string | null {
  const now = Date.now();
  if (period === "7d") return new Date(now - 7 * 86_400_000).toISOString();
  if (period === "30d") return new Date(now - 30 * 86_400_000).toISOString();
  if (period === "today") {
    const algiers = new Date(now + 3_600_000);
    algiers.setUTCHours(0, 0, 0, 0);
    return new Date(algiers.getTime() - 3_600_000).toISOString();
  }
  return null;
}

type SearchContext = {
  search: string;
  start: string | null;
  type: OrdersType;
};

/**
 * Applique le contexte de recherche (texte, période, type) à un builder orders.
 * Générique structurel : accepte la liste paginée ET les counts HEAD.
 */
function applyContext<
  Q extends {
    gte(col: string, v: string): Q;
    eq(col: string, v: string): Q;
    or(filters: string): Q;
  },
>(query: Q, ctx: SearchContext): Q {
  let q = query;
  if (ctx.start) q = q.gte("created_at", ctx.start);
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
  }>;
}) {
  const {
    page: pageParam,
    status: statusParam,
    q: qParam,
    period: periodParam,
    type: typeParam,
  } = await searchParams;
  const page = parsePage(pageParam);
  const filter = parseStatusFilter(statusParam);
  const period = parsePeriod(periodParam);
  const type = parseType(typeParam);
  const search = sanitizeSearch(qParam);
  const ctx: SearchContext = { search, start: periodStart(period), type };

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
        <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
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
