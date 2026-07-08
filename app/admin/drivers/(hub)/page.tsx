import Link from "next/link";
import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/auth/admin";
import { DriverList } from "@/components/admin/drivers/driver-list";
import {
  getDriverRegistrations,
  getDriverRowsForAdmin,
} from "@/lib/data/admin-drivers";

export const dynamic = "force-dynamic";

// Onglet « Livreurs » du hub Livraison : annuaire (recherche + pagination). La
// validation des nouveaux dossiers est dans l'onglet « Inscriptions ».
export default async function AdminDriversPage() {
  if (!(await isSuperAdmin())) redirect("/admin");

  // Annuaire (initialData du cache) + compteur d'inscriptions, en parallèle.
  const [rows, pendingReg] = await Promise.all([
    getDriverRowsForAdmin(),
    getDriverRegistrations().then((r) => r.length),
  ]);

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
      {/* Cible de l'alerte « livreurs bloqués en course » (?focus=…) :
          l'annuaire, où se libère la disponibilité d'un livreur. */}
      <div data-alert-focus="ghost_busy_drivers" className="rounded-[16px]">
        <DriverList initialRows={rows} />
      </div>
    </div>
  );
}
