import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdminContext } from "@/lib/auth/admin";

// =============================================================================
// Données courses Drive côté super-admin (parité lib/data/admin-orders.ts).
// - `searchAdminRides` : RPC `admin_search_rides` (0345), gardée
//   admin_can('drive') côté SQL, appelée avec la SESSION admin.
// - `getAdminRideDetail` : fiche complète (course + événements + ledger +
//   audit). Lectures service_role AUTO-GARDÉES par le contexte admin.
// =============================================================================

export type AdminRideSearchFilters = {
  q?: string;
  chauffeurQ?: string;
  status?: string; // statut exact ou 'active'
  payment?: "cash" | "coligo_pay" | "card";
  /** Type de trajet : 'inter' (inter-wilayas) / 'ville' / undefined = tous. */
  trip?: "inter" | "ville";
  from?: string; // ISO
  to?: string; // ISO (exclusif)
  page?: number;
  pageSize?: number;
};

export type AdminRideRow = {
  id: string;
  status: string;
  payment_method: string;
  price_da: number;
  escrow_da: number;
  admin_refunded_da: number;
  pickup_text: string | null;
  dest_text: string | null;
  gamme: string | null;
  is_interwilaya: boolean;
  pickup_wilaya: string | null;
  dest_wilaya: string | null;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  chauffeur_id: string | null;
  chauffeur_name: string | null;
  cancelled_by: string | null;
  created_at: string;
  completed_at: string | null;
  total_count: number;
};

export async function searchAdminRides(
  filters: AdminRideSearchFilters
): Promise<{ rows: AdminRideRow[]; total: number }> {
  const supabase = await createClient();
  const pageSize = Math.min(Math.max(filters.pageSize ?? 30, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);

  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_search_rides", {
    p_q: filters.q?.trim() || null,
    p_chauffeur_q: filters.chauffeurQ?.trim() || null,
    p_status: filters.status || null,
    p_payment: filters.payment || null,
    p_from: filters.from || null,
    p_to: filters.to || null,
    p_trip: filters.trip || null,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) return { rows: [], total: 0 };

  const rows = (
    (data ?? []) as (Omit<AdminRideRow, "total_count"> & {
      total_count: number | string;
    })[]
  ).map((r) => ({ ...r, total_count: Number(r.total_count) }));
  return { rows, total: rows[0]?.total_count ?? 0 };
}

// -----------------------------------------------------------------------------
// Fiche course
// -----------------------------------------------------------------------------

export type AdminRideEvent = {
  id: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  created_at: string;
};

export type AdminRideLedgerRow = {
  id: string;
  type: string;
  amount_da: number;
  note: string | null;
  settled_at: string | null;
  created_at: string;
};

export type AdminRideAuditRow = {
  id: string;
  admin_email: string | null;
  action: string;
  note: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
};

export type AdminRideDetail = {
  ride: {
    id: string;
    status: string;
    payment_method: string;
    pickup_text: string | null;
    dest_text: string | null;
    distance_km: number | null;
    gamme: string | null;
    is_interwilaya: boolean | null;
    pickup_wilaya: string | null;
    dest_wilaya: string | null;
    proposed_price_da: number | null;
    agreed_price_da: number | null;
    boost_amount_da: number | null;
    escrow_da: number;
    cash_due_da: number | null;
    commission_da: number | null;
    chauffeur_net_da: number | null;
    cashback_da: number | null;
    admin_refunded_da: number;
    online_paid_at: string | null;
    female_only: boolean | null;
    proxy_name: string | null;
    proxy_phone: string | null;
    cancelled_by: string | null;
    customer_id: string;
    chauffeur_id: string | null;
    created_at: string;
    accepted_at: string | null;
    arrived_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    cancelled_at: string | null;
    scheduled_at: string | null;
    expires_at: string | null;
    client_rating: number | null;
    chauffeur_rating: number | null;
  };
  customer: { id: string; full_name: string; phone: string | null } | null;
  chauffeur: {
    id: string;
    full_name: string;
    phone: string | null;
    vehicle_label: string | null;
  } | null;
  events: AdminRideEvent[];
  ledger: AdminRideLedgerRow[];
  audit: AdminRideAuditRow[];
};

export async function getAdminRideDetail(
  rideId: string
): Promise<AdminRideDetail | null> {
  // Self-guard service_role : hors domaine drive → null (fail-closed).
  const ctx = await getAdminContext();
  if (!ctx.isAdmin || !(ctx.isOwner || ctx.domains.includes("drive")))
    return null;

  const admin = createAdminClient();
  const { data: ride } = await admin
    .from("rides")
    .select("*")
    .eq("id", rideId)
    .maybeSingle();
  if (!ride) return null;

  const [
    { data: customer },
    { data: chauffeur },
    { data: events },
    { data: ledger },
    { data: audit },
  ] = await Promise.all([
    admin
      .from("customers")
      .select("id, full_name, phone")
      .eq("id", ride.customer_id)
      .maybeSingle(),
    ride.chauffeur_id
      ? admin
          .from("chauffeurs")
          .select("id, full_name, phone, vehicle_label")
          .eq("id", ride.chauffeur_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("ride_events")
      .select("id, from_status, to_status, note, created_at")
      .eq("ride_id", rideId)
      .order("created_at", { ascending: true }),
    admin
      .from("ride_ledger")
      .select("id, type, amount_da, note, settled_at, created_at")
      .eq("ride_id", rideId)
      .order("created_at", { ascending: true }),
    admin
      .from("admin_audit_log")
      .select(
        "id, admin_email, action, note, old_value, new_value, ip, created_at"
      )
      .eq("target_kind", "ride")
      .eq("target_id", rideId)
      .order("created_at", { ascending: true }),
  ]);

  return {
    // Colonne récente admin_refunded_da (0345) hors types générés → cast.
    ride: ride as unknown as AdminRideDetail["ride"],
    customer: customer ?? null,
    chauffeur: (chauffeur ?? null) as AdminRideDetail["chauffeur"],
    events: (events ?? []) as AdminRideEvent[],
    ledger: (ledger ?? []) as AdminRideLedgerRow[],
    audit: (audit ?? []) as unknown as AdminRideAuditRow[],
  };
}
