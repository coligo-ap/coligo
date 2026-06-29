import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";
import {
  DriverList,
  type DriverRow,
} from "@/components/admin/drivers/driver-list";
import { getDriverRegistrations } from "@/lib/data/admin-drivers";

export const dynamic = "force-dynamic";

// Onglet « Livreurs » du hub Livraison : annuaire (recherche + pagination). La
// validation des nouveaux dossiers est dans l'onglet « Inscriptions ».
export default async function AdminDriversPage() {
  if (!(await isSuperAdmin())) redirect("/admin");

  const admin = createAdminClient();
  const { data: drivers } = await admin
    .from("drivers")
    .select(
      "id, full_name, phone, is_frozen, is_blocked, is_verified, avatar_url, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(2000);

  const driverIds = (drivers ?? []).map((d) => d.id);
  const { data: links } = driverIds.length
    ? await admin
        .from("merchant_drivers")
        .select("driver_id, status")
        .in("driver_id", driverIds)
    : { data: [] };

  const stats = new Map<
    string,
    { active: number; pending: number; blocked: number }
  >();
  for (const l of links ?? []) {
    const cur = stats.get(l.driver_id) ?? { active: 0, pending: 0, blocked: 0 };
    cur[l.status as "active" | "pending" | "blocked"] += 1;
    stats.set(l.driver_id, cur);
  }

  const rows: DriverRow[] = (drivers ?? []).map((d) => {
    const s = stats.get(d.id) ?? { active: 0, pending: 0, blocked: 0 };
    return {
      id: d.id,
      full_name: d.full_name,
      phone: d.phone,
      is_frozen: d.is_frozen,
      is_blocked: d.is_blocked,
      is_verified: d.is_verified,
      avatar_url: d.avatar_url,
      active: s.active,
      pending: s.pending,
      blocked: s.blocked,
    };
  });

  const pendingReg = (await getDriverRegistrations()).length;

  return (
    <div className="space-y-4">
      {pendingReg > 0 && (
        <Link
          href="/admin/drivers/inscriptions"
          className="border-warning-200 bg-warning-50/60 text-warning-900 hover:bg-warning-100 flex items-center gap-2 rounded-[12px] border px-4 py-3 text-sm font-medium transition-colors"
        >
          {pendingReg} livreur{pendingReg > 1 ? "s" : ""} avec des pièces à
          valider — ouvrir l&apos;onglet Inscriptions →
        </Link>
      )}
      <DriverList rows={rows} />
    </div>
  );
}
