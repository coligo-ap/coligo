import { redirect } from "next/navigation";
import Link from "next/link";
import { isSuperAdmin } from "@/lib/auth/admin";
import { ChauffeurList } from "@/components/admin/chauffeurs/chauffeur-list";
import { getChauffeurRowsForAdmin } from "@/lib/data/admin-chauffeurs";

export const dynamic = "force-dynamic";

// Onglet « Chauffeurs » du hub Coligo Drive : annuaire (recherche + pagination).
// La validation des nouveaux dossiers est dans l'onglet « Inscriptions ».
export default async function AdminChauffeursPage() {
  if (!(await isSuperAdmin())) redirect("/admin");

  const rows = await getChauffeurRowsForAdmin();
  const pendingCount = rows.filter(
    (c) => !c.is_verified && !c.is_blocked && c.submitted_at
  ).length;

  return (
    <div className="space-y-4">
      {pendingCount > 0 && (
        <Link
          href="/admin/chauffeurs/inscriptions"
          className="border-warning-200 bg-warning-50/60 text-warning-900 hover:bg-warning-100 flex items-center gap-2 rounded-[12px] border px-4 py-3 text-sm font-medium transition-colors"
        >
          {pendingCount} dossier{pendingCount > 1 ? "s" : ""} de chauffeur à
          valider — ouvrir l&apos;onglet Inscriptions →
        </Link>
      )}
      <ChauffeurList initialRows={rows} />
    </div>
  );
}
