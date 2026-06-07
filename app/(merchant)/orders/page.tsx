import { createClient } from "@/lib/supabase/server";
import { OrdersBrowser } from "@/components/merchant/orders-browser";
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

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const { page: pageParam, status: statusParam } = await searchParams;
  const page = parsePage(pageParam);
  const filter = parseStatusFilter(statusParam);

  const supabase = await createClient();

  // Query orders : pagination ranges + count exact pour calculer le nombre
  // de pages. RLS filtre déjà sur le commerçant connecté.
  let query = supabase
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
    .order("created_at", { ascending: false });

  if (filter.statuses.length > 0) {
    query = query.in("status", filter.statuses);
  }

  const offset = (page - 1) * PAGE_SIZE;
  const {
    data: orders,
    count,
    error,
  } = await query.range(offset, offset + PAGE_SIZE - 1);

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

  // Compteurs par statut (sur l'ensemble des commandes, pas seulement la
  // page courante) — petite query séparée. Sert à afficher « Pending (12) »
  // dans les onglets de filtre. `head: true` + count exact = pas de payload.
  const statusCounts = await fetchStatusCounts(supabase);

  return (
    <OrdersBrowser
      orders={ordersList}
      page={page}
      pageCount={pageCount}
      total={total}
      filter={filter.key}
      statusCounts={statusCounts}
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
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<StatusCounts> {
  // 6 requêtes HEAD count (très légères, RLS appliquée). Lancées en parallèle.
  // PostgrestBuilder est `then`-able : Promise.all accepte directement la
  // chaîne `.select(..., { head: true })`.
  const [all, pending, preparing, ready, completed, cancelled] =
    await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .in("status", ["accepted", "preparing"]),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "ready"),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed"),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "cancelled"),
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
