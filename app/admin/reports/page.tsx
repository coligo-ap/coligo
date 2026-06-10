import { createClient } from "@/lib/supabase/server";
import { AdminReportsList } from "@/components/admin/admin-reports-list";

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
  // IMPORTANT : appeler supabase.rpc EN MÉTHODE (this lié). Extraire la fonction
  // (`const rpc = supabase.rpc`) casse `this.rest` → exception serveur.
  const { data, error } = await supabase.rpc(
    "admin_delivery_reports" as never,
    { p_limit: 300 } as never
  );
  if (error) {
    console.error("admin_delivery_reports:", error.message);
  }
  const rows = (Array.isArray(data) ? data : []) as ReportRow[];

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Signalements</h1>
        <p className="text-muted mt-1 text-sm">
          Signalements de livraison (client ↔ livreur). Traitez chaque cas : en
          cours, résolu ou rejeté.
        </p>
      </header>
      <AdminReportsList rows={rows} />
    </div>
  );
}
