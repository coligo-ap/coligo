import { redirect } from "next/navigation";
import { Car } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";
import { ChauffeurActions } from "@/components/admin/chauffeur-actions";

export const dynamic = "force-dynamic";

export default async function AdminChauffeursPage() {
  if (!(await isSuperAdmin())) redirect("/admin");

  const admin = createAdminClient();
  const { data: chauffeurs } = await admin
    .from("chauffeurs")
    .select(
      "id, full_name, phone, vehicle_make, vehicle_model, vehicle_plate, is_verified, is_frozen, is_blocked, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(500);

  const rows = chauffeurs ?? [];
  const pending = rows.filter((c) => !c.is_verified && !c.is_blocked).length;

  const vehicleOf = (c: (typeof rows)[number]) =>
    [c.vehicle_make, c.vehicle_model].filter(Boolean).join(" ") || "—";

  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6">
      <header className="mb-5 flex items-center gap-2">
        <Car className="size-6" />
        <h1 className="text-2xl font-bold tracking-tight">Chauffeurs VTC</h1>
        {pending > 0 && (
          <span className="bg-warning-100 text-warning-800 ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold">
            {pending} à vérifier
          </span>
        )}
      </header>

      <p className="text-muted mb-4 text-sm">
        Un chauffeur ne peut <strong>recevoir des courses</strong> qu&apos;une
        fois <strong>vérifié</strong>. « Geler » le retire temporairement du
        réseau ; « Bloquer » suspend le compte.
      </p>

      {rows.length === 0 ? (
        <div className="bg-surface border-border text-muted rounded-[14px] border p-8 text-center text-sm">
          Aucun chauffeur inscrit pour l&apos;instant.
        </div>
      ) : (
        <div className="bg-surface border-border overflow-x-auto rounded-[14px] border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Nom</th>
                <th className="px-3 py-2 text-left">Téléphone</th>
                <th className="px-3 py-2 text-left">Véhicule</th>
                <th className="px-3 py-2 text-left">Plaque</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-border border-t">
                  <td className="px-3 py-2 font-medium">{c.full_name}</td>
                  <td className="text-muted px-3 py-2 tabular-nums">
                    {c.phone}
                  </td>
                  <td className="text-muted px-3 py-2">{vehicleOf(c)}</td>
                  <td className="text-muted px-3 py-2">
                    {c.vehicle_plate || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <ChauffeurActions
                      chauffeurId={c.id}
                      isVerified={!!c.is_verified}
                      isFrozen={!!c.is_frozen}
                      isBlocked={!!c.is_blocked}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
