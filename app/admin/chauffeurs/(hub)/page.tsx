import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";
import {
  ChauffeurList,
  type ChauffeurRow,
} from "@/components/admin/chauffeurs/chauffeur-list";

export const dynamic = "force-dynamic";

// Onglet « Chauffeurs » du hub Coligo Drive : annuaire (recherche + pagination).
// La validation des nouveaux dossiers est dans l'onglet « Inscriptions ».
export default async function AdminChauffeursPage() {
  if (!(await isSuperAdmin())) redirect("/admin");

  const admin = createAdminClient();
  const { data } = await admin
    .from("chauffeurs")
    .select(
      "id, full_name, phone, gamme, vehicle_make, vehicle_model, vehicle_plate, is_verified, is_frozen, is_blocked, frozen_reason, submitted_at"
    )
    .order("created_at", { ascending: false })
    .limit(2000);

  const rows = (data ?? []) as (ChauffeurRow & {
    submitted_at: string | null;
  })[];
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
      <ChauffeurList rows={rows} />
    </div>
  );
}
