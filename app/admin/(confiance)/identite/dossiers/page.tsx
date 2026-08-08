import Link from "next/link";
import { ChevronRight, ShieldQuestion } from "lucide-react";
import { getIdvReviewQueue } from "@/lib/idv/admin-data";

export const dynamic = "force-dynamic";

// =============================================================================
// /admin/identite/dossiers — FILE de revue humaine (étape 8). Les dossiers
// arrivent ici quand la décision automatique n'a pas tranché (zone
// intermédiaire, contrôle en échec, panne du pipeline) ou qu'une règle du
// mode l'a exigé. Tri FIFO : le plus ancien d'abord.
// =============================================================================

const dtf = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Africa/Algiers",
});

const PROFILE_LABEL: Record<string, string> = {
  driver: "Livreur",
  chauffeur: "Chauffeur",
  merchant: "Commerçant",
};

const DOC_LABEL: Record<string, string> = {
  dz_passport: "Passeport",
  dz_cni: "CNI",
  dz_permis: "Permis",
};

/** Pastille de score : vert (élevé), ambre (zone grise), rouge (faible). */
function ScorePill({ label, score }: { label: string; score: number | null }) {
  if (score == null) {
    return (
      <span className="bg-surface-2 text-muted text-caption rounded-full px-2 py-0.5">
        {label} —
      </span>
    );
  }
  const pct = Math.round(score * 100);
  const tone =
    score >= 0.6
      ? "bg-success-100 text-success-700"
      : score < 0.35
        ? "bg-danger-100 text-danger-700"
        : "bg-warning-100 text-warning-700";
  return (
    <span
      className={`text-caption rounded-full px-2 py-0.5 font-medium ${tone}`}
    >
      {label} {pct} %
    </span>
  );
}

export default async function AdminIdvQueuePage() {
  const queue = await getIdvReviewQueue(50);

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 lg:px-6">
      <div>
        <h2 className="font-bold tracking-tight">Dossiers à vérifier</h2>
        <p className="text-muted mt-0.5 text-sm">
          {queue.length === 0
            ? "Aucun dossier en attente."
            : `${queue.length} dossier${queue.length > 1 ? "s" : ""} en attente de décision humaine.`}
        </p>
      </div>

      {queue.length === 0 ? (
        <div className="border-border bg-surface flex flex-col items-center gap-2 rounded-lg border p-10 text-center">
          <ShieldQuestion className="text-muted size-8" />
          <p className="text-muted text-sm">
            La file est vide — les vérifications tranchées automatiquement
            n&apos;apparaissent pas ici.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {queue.map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/identite/dossiers/${c.id}`}
                className="border-border bg-surface hover:bg-surface-2 flex items-center gap-3 rounded-lg border p-3 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {c.person_name ?? "Partenaire sans nom"}
                    {c.person_phone && (
                      <span className="text-muted ml-2 text-xs">
                        {c.person_phone}
                      </span>
                    )}
                  </p>
                  <p className="text-muted mt-0.5 text-xs">
                    {PROFILE_LABEL[c.profile] ?? c.profile} ·{" "}
                    {DOC_LABEL[c.document_type ?? ""] ?? "Document"} · {c.mode}{" "}
                    · déposé le {dtf.format(new Date(c.created_at))}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {/* RECOURS (mig 0371) : la machine a refusé, la personne a
                        demandé un examen humain. Les scores ne veulent plus rien
                        dire ici — ce dossier se juge sur PIÈCES. */}
                    {c.manual_fallback ? (
                      <span className="bg-warning-50 text-warning-700 text-caption rounded-full px-2 py-0.5 font-semibold">
                        Recours — refusé automatiquement, à juger sur pièces
                      </span>
                    ) : (
                      <>
                        <ScorePill label="Visage" score={c.face_match} />
                        <ScorePill label="Présence" score={c.liveness} />
                      </>
                    )}
                  </div>
                </div>
                <ChevronRight className="text-muted size-5 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
