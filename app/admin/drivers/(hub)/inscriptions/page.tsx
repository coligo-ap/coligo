import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Clock, FileText, UserRound } from "lucide-react";
import { isSuperAdmin } from "@/lib/auth/admin";
import { getDriverRegistrations } from "@/lib/data/admin-drivers";

export const dynamic = "force-dynamic";

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0))
      .join("")
      .toUpperCase() || "?"
  );
}

// Onglet « Inscriptions » du hub Livraison : livreurs ayant TRANSMIS leur
// dossier et attendant la décision de l'équipe Coligo. Tant qu'ils n'ont pas
// validé, ils n'ont accès à aucune fonctionnalité. La revue des documents et la
// décision (valider / refuser) se font sur la fiche du livreur.
export default async function DriverRegistrationsTab() {
  if (!(await isSuperAdmin())) redirect("/admin");

  const drivers = await getDriverRegistrations();

  return (
    <div className="space-y-4">
      <p className="text-muted text-sm">
        Livreurs ayant transmis leur dossier et{" "}
        <strong>en attente de validation</strong>. Leur compte reste verrouillé
        (aucune mise en ligne, aucune course) tant qu&apos;il n&apos;est pas
        validé. Ouvrez une fiche pour examiner les documents et décider.
      </p>

      <section className="border-warning-200 bg-warning-50/60 rounded-[16px] border p-4 lg:p-5">
        <h2 className="text-warning-900 mb-3 flex items-center gap-2 text-base font-bold">
          <Clock className="size-4" />À valider ({drivers.length})
        </h2>
        {drivers.length === 0 ? (
          <p className="text-muted text-sm">
            Aucune pièce en attente. Tout est traité ✅
          </p>
        ) : (
          <ul className="space-y-2">
            {drivers.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/admin/drivers/${d.id}`}
                  className="border-warning-200 bg-surface hover:bg-surface-2 flex items-center gap-3 rounded-[14px] border p-3"
                >
                  {d.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={d.avatar_url}
                      alt=""
                      className="size-10 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span className="bg-primary-100 text-primary-700 grid size-10 shrink-0 place-items-center rounded-full text-xs font-bold">
                      {initials(d.full_name)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {d.full_name}
                    </p>
                    <p className="text-muted flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                      <span className="flex items-center gap-1">
                        <UserRound className="size-3" />
                        {d.phone ?? "—"}
                      </span>
                      <span className="text-warning-800 flex items-center gap-1 font-semibold">
                        <FileText className="size-3" />
                        {d.pendingDocs} pièce{d.pendingDocs > 1 ? "s" : ""} à
                        examiner
                      </span>
                      <span>
                        Transmis le{" "}
                        {new Date(d.submitted_at).toLocaleDateString("fr-FR")}
                      </span>
                    </p>
                  </div>
                  <ChevronRight className="text-muted size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
