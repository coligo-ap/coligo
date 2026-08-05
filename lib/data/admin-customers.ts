import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminCan } from "@/lib/auth/admin";
import {
  CUSTOMERS_PAGE_SIZE,
  type CustomerDetail,
  type CustomerFraudSanction,
  type CustomerLocation,
  type CustomerRow,
  type CustomersPage,
  type CustomerStatusFilter,
} from "@/lib/admin/customer-features";

// Les types et libellés vivent dans un module PUR (consommé par les composants
// « use client ») ; on les ré-expose ici pour les appelants serveur.
export * from "@/lib/admin/customer-features";

// =============================================================================
// Espace CLIENTS du super-admin (mig 0397/0398).
//
// Deux chemins de lecture, chacun choisi pour ce qu'il garantit :
//   - l'ANNUAIRE et les LOCALISATIONS passent par des RPC SECURITY DEFINER
//     gardées `admin_can('clients')` EN BASE : même si l'app oubliait un gate,
//     la base refuse ;
//   - la FICHE agrège des tables sans policy admin (customers, wallet, adresses)
//     → lecture service_role, AUTO-GARDÉE ici (self-guard) pour que tout
//     appelant, page ou route API, soit couvert.
// =============================================================================

/** Annuaire paginé — recherche nom / téléphone / e-mail / handle Pay.
 *  `limit` (≤ CUSTOMERS_PAGE_SIZE) sert à l'ÉCHANTILLON initial de la page :
 *  3 lignes suffisent, la recherche charge la suite à la demande. */
export async function listCustomers({
  q = "",
  status = "all",
  page = 1,
  limit,
}: {
  q?: string;
  status?: CustomerStatusFilter;
  page?: number;
  limit?: number;
} = {}): Promise<CustomersPage> {
  const pageSize = Math.min(
    Math.max(1, Math.floor(limit ?? CUSTOMERS_PAGE_SIZE)),
    CUSTOMERS_PAGE_SIZE
  );
  const empty = {
    rows: [],
    total: 0,
    page: 1,
    pageSize,
  };
  if (!(await adminCan("clients"))) return empty;

  const supabase = await createClient();
  // RPC hors types générés → bind + cast (cf. reference_supabase_rpc_bind).
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;

  const safePage = Math.max(1, Math.floor(page));
  const { data, error } = await rpc("admin_customers_directory", {
    p_q: q.trim() || null,
    p_status: status,
    p_limit: pageSize,
    p_offset: (safePage - 1) * pageSize,
  });
  if (error) {
    console.error("admin_customers_directory:", error.message);
    return empty;
  }

  const raw = (data ?? []) as (Omit<
    CustomerRow,
    "orders_count" | "orders_completed" | "spend_da" | "rides_count"
  > & {
    orders_count: number | string;
    orders_completed: number | string;
    spend_da: number | string;
    rides_count: number | string;
    total_count: number | string;
  })[];

  return {
    rows: raw.map((r) => ({
      ...r,
      orders_count: Number(r.orders_count ?? 0),
      orders_completed: Number(r.orders_completed ?? 0),
      spend_da: Number(r.spend_da ?? 0),
      rides_count: Number(r.rides_count ?? 0),
      rating_avg: Number(r.rating_avg ?? 0),
      blocked_features: r.blocked_features ?? [],
      fraud_suspended: r.fraud_suspended === true,
    })),
    total: Number(raw[0]?.total_count ?? 0),
    page: safePage,
    pageSize,
  };
}

/** Traces de position, de la plus récente à la plus ancienne. */
export async function getCustomerLocations(
  customerId: string,
  limit = 40
): Promise<CustomerLocation[]> {
  if (!(await adminCan("clients"))) return [];
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_customer_locations", {
    p_customer_id: customerId,
    p_limit: limit,
  });
  if (error) {
    console.error("admin_customer_locations:", error.message);
    return [];
  }
  return (data ?? []) as CustomerLocation[];
}

/**
 * Fiche complète. Lecture service_role AUTO-GARDÉE : `customers` n'a pas de
 * policy admin (seulement « propriétaire »), donc l'agrégat passe par le client
 * admin — et le gate vit ici pour couvrir tous les appelants.
 */
export async function getCustomerDetail(
  customerId: string
): Promise<CustomerDetail | null> {
  if (!(await adminCan("clients"))) return null;
  const admin = createAdminClient();
  const from = admin.from.bind(admin) as unknown as (t: string) => {
    select: (cols: string) => {
      eq: (
        c: string,
        v: string
      ) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
        order: (
          c: string,
          o: { ascending: boolean }
        ) => {
          limit: (
            n: number
          ) => Promise<{ data: Record<string, unknown>[] | null }>;
        };
      };
    };
  };

  const { data: row } = await from("customers")
    .select("*")
    .eq("id", customerId)
    .maybeSingle();
  if (!row) return null;

  // Sanctions anti-fraude ACTIVES (mig 0374) : la fiche doit montrer la MÊME
  // vérité que l'app client (customer_fraud_gate) — un compte suspendu par le
  // module Anti-fraude ne doit jamais s'afficher « Actif » ici — et permettre
  // de LEVER chaque sanction sur place (section dédiée, pas de redirection).
  const fraudFrom = admin.from.bind(admin) as unknown as (t: string) => {
    select: (c: string) => {
      eq: (
        c1: string,
        v1: string
      ) => {
        eq: (
          c2: string,
          v2: string
        ) => {
          is: (
            c3: string,
            v3: null
          ) => {
            order: (
              c4: string,
              o: { ascending: boolean }
            ) => Promise<{
              data:
                | {
                    id: string;
                    action: string;
                    source: "auto" | "admin";
                    reason: string;
                    created_at: string;
                    expires_at: string | null;
                  }[]
                | null;
            }>;
          };
        };
      };
    };
  };
  const fraudSanctionsPromise = fraudFrom("fraud_actions")
    .select("id, action, source, reason, created_at, expires_at")
    .eq("actor_kind", "customer")
    .eq("actor_id", customerId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .then(({ data }) =>
      (data ?? []).filter(
        (r) => !r.expires_at || new Date(r.expires_at).getTime() > Date.now()
      )
    )
    .catch((): CustomerFraudSanction[] => []);

  const [
    { data: features },
    { data: orders },
    { data: devices },
    locations,
    fraudSanctions,
  ] = await Promise.all([
    from("customer_feature_blocks")
      .select("feature, reason, created_at")
      .eq("customer_id", customerId)
      .order("feature", { ascending: true })
      .limit(20),
    from("orders")
      .select(
        "id, order_number, status, total_da, payment_method, fulfillment_type, delivery_mode, created_at, merchants(name)"
      )
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(20),
    from("user_device_log")
      .select("ip, platform, city, country, last_seen_at, hits")
      .eq("user_id", String(row.user_id))
      .order("last_seen_at", { ascending: false })
      .limit(10),
    getCustomerLocations(customerId, 40),
    fraudSanctionsPromise,
  ]);

  const blockedFeatures = (features ?? []).map((f) => String(f.feature));
  const orderRows = (orders ?? []) as Record<string, unknown>[];
  const completed = orderRows.filter((o) => o.status === "completed");

  return {
    customer: {
      id: String(row.id),
      user_id: String(row.user_id),
      full_name: String(row.full_name ?? ""),
      phone: (row.phone as string) ?? null,
      email: (row.email as string) ?? null,
      pay_handle: (row.pay_handle as string) ?? null,
      created_at: String(row.created_at),
      wilaya_code: (row.default_wilaya_code as string) ?? null,
      commune: (row.default_commune as string) ?? null,
      is_blocked: row.is_blocked === true,
      blocked_at: (row.blocked_at as string) ?? null,
      blocked_reason: (row.blocked_reason as string) ?? null,
      fraud_suspended: fraudSanctions.some((s) => s.action === "suspend"),
      blocked_by: (row.blocked_by as string) ?? null,
      admin_note: (row.admin_note as string) ?? null,
      cod_blocked: row.cod_blocked === true,
      noshow_count: Number(row.noshow_count ?? 0),
      noshow_pending: row.noshow_pending === true,
      is_female_verified: row.is_female_verified === true,
      rating_avg: Number(row.rating_avg ?? 0),
      rating_count: Number(row.rating_count ?? 0),
      blocked_features: blockedFeatures,
      orders_count: orderRows.length,
      orders_completed: completed.length,
      spend_da: completed.reduce((s, o) => s + Number(o.total_da ?? 0), 0),
      rides_count: 0,
      cashback_balance_da: 0,
      topup_balance_da: 0,
      last_seen_at: (devices?.[0]?.last_seen_at as string) ?? null,
      last_city: (devices?.[0]?.city as string) ?? null,
      last_country: (devices?.[0]?.country as string) ?? null,
      last_lat: null,
      last_lng: null,
    },
    features: (features ?? []).map((f) => ({
      feature: String(f.feature),
      reason: (f.reason as string) ?? null,
      created_at: String(f.created_at),
    })),
    orders: orderRows.map((o) => ({
      id: String(o.id),
      order_number: (o.order_number as number) ?? null,
      status: String(o.status),
      total_da: Number(o.total_da ?? 0),
      payment_method: String(o.payment_method ?? ""),
      fulfillment_type: (o.fulfillment_type as string) ?? null,
      delivery_mode: (o.delivery_mode as string) ?? null,
      created_at: String(o.created_at),
      merchant_name:
        ((o.merchants as { name?: string } | null)?.name as string) ?? null,
    })),
    devices: (devices ?? []).map((d) => ({
      ip: String(d.ip ?? ""),
      platform: (d.platform as string) ?? null,
      city: (d.city as string) ?? null,
      country: (d.country as string) ?? null,
      last_seen_at: String(d.last_seen_at),
      hits: Number(d.hits ?? 0),
    })),
    locations,
    fraud_sanctions: fraudSanctions,
  };
}
