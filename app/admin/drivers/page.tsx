import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeCheck, ChevronRight, Truck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";
import { DriverFreezeButton } from "@/components/admin/driver-freeze-button";

export const dynamic = "force-dynamic";

export default async function AdminDriversPage() {
  if (!(await isSuperAdmin())) redirect("/admin");

  // Service-role pour voir tous les drivers + jointures (RLS de drivers
  // restreint la lecture aux utilisateurs concernés).
  const admin = createAdminClient();

  const { data: drivers } = await admin
    .from("drivers")
    .select("id, full_name, phone, is_frozen, is_verified, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  // Quick stats par livreur
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

  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6">
      <header className="mb-5 flex items-center gap-2">
        <Truck className="size-6" />
        <h1 className="text-2xl font-bold tracking-tight">Livreurs</h1>
      </header>

      <table className="bg-surface border-border w-full overflow-hidden rounded-[14px] border text-sm">
        <thead className="bg-surface-2 text-muted text-xs uppercase">
          <tr>
            <th className="px-3 py-2 text-left">Nom</th>
            <th className="px-3 py-2 text-left">Téléphone</th>
            <th className="px-3 py-2 text-center">Vérifié</th>
            <th className="px-3 py-2 text-right">Actifs</th>
            <th className="px-3 py-2 text-right">En attente</th>
            <th className="px-3 py-2 text-right">Bloqués</th>
            <th className="px-3 py-2 text-center">Gelé</th>
            <th className="px-3 py-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {(drivers ?? []).map((d) => {
            const s = stats.get(d.id) ?? { active: 0, pending: 0, blocked: 0 };
            return (
              <tr key={d.id} className="hover:bg-surface-2">
                <td className="px-3 py-2 font-medium">
                  <Link
                    href={`/admin/drivers/${d.id}`}
                    className="hover:text-primary-700 inline-flex items-center gap-1"
                  >
                    {d.full_name}
                    <ChevronRight className="text-muted size-3.5" />
                  </Link>
                </td>
                <td className="text-muted px-3 py-2 tabular-nums">{d.phone}</td>
                <td className="px-3 py-2 text-center">
                  {d.is_verified ? (
                    <BadgeCheck className="text-success-600 inline size-4" />
                  ) : (
                    <span className="text-muted text-xs">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {s.active}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {s.pending}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {s.blocked}
                </td>
                <td className="px-3 py-2 text-center">
                  {d.is_frozen ? (
                    <span className="bg-danger-100 text-danger-700 rounded-full px-2 py-0.5 text-xs">
                      Gelé
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/admin/drivers/${d.id}`}
                      className="border-border hover:bg-surface-2 rounded-[8px] border px-2.5 py-1 text-xs font-semibold"
                    >
                      Gérer
                    </Link>
                    <DriverFreezeButton
                      driverId={d.id}
                      frozen={d.is_frozen ?? false}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
          {(drivers ?? []).length === 0 && (
            <tr>
              <td colSpan={8} className="text-muted px-3 py-6 text-center">
                Aucun livreur enregistré.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
