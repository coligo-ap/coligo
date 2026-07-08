import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminReportsList } from "@/components/admin/admin-reports-list";
import {
  AdminRideReportsList,
  type RideReportRow,
} from "@/components/admin/admin-ride-reports-list";
import {
  AdminRefundClaims,
  type RefundClaimRow,
} from "@/components/admin/admin-refund-claims";

export const dynamic = "force-dynamic";

/**
 * Modération des signalements de livraison (super-admin). Le layout /admin gate
 * déjà sur requireSuperAdmin(). Données via la RPC SECURITY DEFINER
 * `admin_delivery_reports` (gardée par is_super_admin côté SQL).
 */

type ReportRow = {
  id: string;
  order_id: string;
  order_number: string | null;
  reporter_role: "customer" | "driver";
  reason: string;
  details: string | null;
  status: "open" | "reviewing" | "resolved" | "dismissed";
  customer_name: string | null;
  driver_name: string | null;
  created_at: string;
  resolved_at: string | null;
  admin_note: string | null;
};

export default async function AdminReportsPage() {
  const supabase = await createClient();
  const admin = createAdminClient();

  // Les 3 sources sont indépendantes → fetch EN PARALLÈLE (perf : on ne paie pas
  // 3 allers-retours en série). RPC appelées EN MÉTHODE (this lié, cf. bind).
  const [deliveryRes, rideRes, claimRes] = await Promise.all([
    supabase.rpc("admin_delivery_reports" as never, { p_limit: 300 } as never),
    supabase.rpc("admin_ride_reports" as never, { p_limit: 300 } as never),
    admin
      .from("driver_refund_claims")
      .select(
        `id, order_id, advance_da, reason, status, goods_decision, admin_note,
         created_at, driver_id,
         drivers ( full_name, phone ),
         orders ( order_number ),
         merchants ( name ),
         customers ( noshow_count )`
      )
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (deliveryRes.error)
    console.error("admin_delivery_reports:", deliveryRes.error.message);
  if (rideRes.error)
    console.error("admin_ride_reports:", rideRes.error.message);

  const rows = (
    Array.isArray(deliveryRes.data) ? deliveryRes.data : []
  ) as ReportRow[];
  const rideRows = (
    Array.isArray(rideRes.data) ? rideRes.data : []
  ) as RideReportRow[];
  const claimRows = claimRes.data;

  type RawClaim = {
    id: string;
    order_id: string;
    advance_da: number;
    reason: string;
    status: "pending" | "approved" | "rejected";
    goods_decision: RefundClaimRow["goods_decision"];
    admin_note: string | null;
    created_at: string;
    driver_id: string;
    drivers: { full_name: string; phone: string } | null;
    orders: { order_number: string | null } | null;
    merchants: { name: string } | null;
    customers: { noshow_count: number } | null;
  };
  const raw = (claimRows ?? []) as unknown as RawClaim[];
  // Compteur de réclamations par livreur (détection d'abus).
  const byDriver = new Map<string, number>();
  for (const c of raw) {
    byDriver.set(c.driver_id, (byDriver.get(c.driver_id) ?? 0) + 1);
  }
  const claims: RefundClaimRow[] = raw.map((c) => ({
    id: c.id,
    order_id: c.order_id,
    advance_da: c.advance_da,
    reason: c.reason,
    status: c.status,
    goods_decision: c.goods_decision,
    admin_note: c.admin_note,
    created_at: c.created_at,
    order_number: c.orders?.order_number ?? null,
    driver_name: c.drivers?.full_name ?? null,
    driver_phone: c.drivers?.phone ?? null,
    driver_claims_count: byDriver.get(c.driver_id) ?? 1,
    merchant_name: c.merchants?.name ?? null,
    customer_noshow_count: c.customers?.noshow_count ?? null,
  }));

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Signalements</h1>
        <p className="text-muted mt-1 text-sm">
          Signalements de livraison (client ↔ livreur). Traitez chaque cas : en
          cours, résolu ou rejeté.
        </p>
      </header>

      <section
        data-alert-focus="driver_refund_pending"
        className="mb-8 rounded-[16px]"
      >
        <h2 className="mb-2 text-lg font-semibold">
          Avances no-show à valider
        </h2>
        <p className="text-muted mb-3 text-sm">
          Le livreur a avancé l&apos;argent de la commande au commerçant, le
          client n&apos;a pas répondu (paiement espèces). Choisis le sort de la
          marchandise : retour au commerçant (remboursement en main propre),
          garder ou donner (Coligo crédite le relevé du livreur).
        </p>
        <AdminRefundClaims rows={claims} />
      </section>

      <section
        data-alert-focus="delivery_reports_open"
        className="rounded-[16px]"
      >
        <h2 className="mb-2 text-lg font-semibold">
          Signalements de livraison
        </h2>
        <AdminReportsList rows={rows} />
      </section>

      <section
        data-alert-focus="ride_reports_open"
        className="mt-8 rounded-[16px]"
      >
        <h2 className="mb-2 text-lg font-semibold">
          Signalements de course (Coligo Drive)
        </h2>
        <p className="text-muted mb-3 text-sm">
          Litiges signalés sur une course (client ↔ chauffeur). Traitez chaque
          cas.
        </p>
        <AdminRideReportsList rows={rideRows} />
      </section>
    </div>
  );
}
