import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getIdvCaseDetail } from "@/lib/idv/admin-data";
import { IDV_CHECK_LABELS_FR, IDV_STATUS_LABELS_FR } from "@/lib/idv/types";
import { IdvDecisionPanel } from "@/components/admin/idv/idv-decision-panel";

export const dynamic = "force-dynamic";

// =============================================================================
// /admin/identite/dossiers/[id] — FICHE de revue : selfie et document CÔTE À
// CÔTE, informations extraites, résultat détaillé de chaque contrôle avec ses
// scores, panneau de décision, journal d'audit complet. Les captures sont
// servies par URL SIGNÉE courte (bucket privé) — jamais publiques.
// =============================================================================

const dtf = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Africa/Algiers",
});

const CHECK_STATUS: Record<string, { label: string; tone: string }> = {
  passed: { label: "OK", tone: "bg-success-100 text-success-700" },
  failed: { label: "Échec", tone: "bg-danger-100 text-danger-700" },
  warning: { label: "Alerte", tone: "bg-warning-100 text-warning-700" },
  skipped: { label: "Non exécuté", tone: "bg-surface-2 text-muted" },
  error: { label: "Erreur technique", tone: "bg-warning-100 text-warning-700" },
};

/** Libellés FR des champs extraits de la MRZ. */
const FIELD_LABELS: Record<string, string> = {
  surname: "Nom",
  given_names: "Prénoms",
  document_number: "N° du document",
  nationality: "Nationalité",
  birth_date: "Date de naissance",
  sex: "Sexe",
  expiry_date: "Expiration",
  personal_number: "N° personnel",
  issuing_country: "Pays émetteur",
  document_code: "Type",
  mrz_format: "Format MRZ",
};

const AUDIT_ACTIONS: Record<string, string> = {
  document_uploaded: "Document déposé",
  document_processed: "Document analysé",
  selfie_uploaded: "Selfie déposé",
  selfie_processed: "Selfie analysé",
  auto_approved: "Approbation automatique",
  auto_rejected: "Refus automatique",
  sent_to_review: "Envoyé en revue humaine",
  manual_approved: "Approuvé par un admin",
  manual_rejected: "Refusé par un admin",
  resubmit_requested: "Nouvelle pièce demandée",
  note_added: "Commentaire interne",
};

export default async function AdminIdvCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getIdvCaseDetail(id);
  if (!detail) notFound();

  const { verification: v, person, checks, audit, urls } = detail;
  const closed = ["approved", "rejected", "canceled", "expired"].includes(
    v.status
  );
  const extracted = (v.extracted ?? {}) as Record<string, unknown>;
  const today = new Date().toISOString().slice(0, 10);
  const expired = Boolean(
    v.document_expires_at && v.document_expires_at < today
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-5 lg:px-6">
      <div>
        <Link
          href="/admin/identite/dossiers"
          className="text-muted hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" />
          Retour à la file
        </Link>
        <h2 className="mt-2 font-bold tracking-tight">
          {person?.name ?? "Partenaire"}{" "}
          <span className="text-muted text-sm font-normal">
            {person?.phone ?? ""}
          </span>
        </h2>
        <p className="text-muted mt-0.5 text-sm">
          {IDV_STATUS_LABELS_FR[v.status]} · {v.profile} · mode {v.mode} ·
          tentative {v.attempt} · déposé le {dtf.format(new Date(v.created_at))}
        </p>
      </div>

      {/* RECOURS (mig 0371) : la vérification automatique a refusé, la personne
          a demandé l'examen humain. On le dit AVANT les scores — sinon l'équipe
          jugerait sur des chiffres que la machine a déjà mal lus. */}
      {v.manual_fallback && (
        <div className="border-warning-200 bg-warning-50 text-warning-800 rounded-card-lg border p-3 text-sm">
          <b className="block">Recours après refus automatique</b>
          Ce dossier est à juger <b>sur pièces</b> : comparez vous-même le
          selfie et le document. Les scores ci-dessous sont ceux de la tentative
          refusée — ils ne décident plus.
        </div>
      )}

      {/* ── Comparaison CÔTE À CÔTE ──────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Selfie ↔ Document</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <figure className="border-border bg-surface overflow-hidden rounded-lg border">
            {urls.selfie ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL signée éphémère
              <img
                src={urls.selfie}
                alt="Selfie du partenaire"
                className="max-h-[420px] w-full bg-black object-contain"
              />
            ) : (
              <div className="text-muted p-10 text-center text-sm">
                Aucun selfie
              </div>
            )}
            <figcaption className="text-muted p-2 text-xs">Selfie</figcaption>
          </figure>
          <figure className="border-border bg-surface overflow-hidden rounded-lg border">
            {urls.docFront ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL signée éphémère
              <img
                src={urls.docFront}
                alt="Recto du document"
                className="max-h-[420px] w-full bg-black object-contain"
              />
            ) : (
              <div className="text-muted p-10 text-center text-sm">
                Aucun document
              </div>
            )}
            <figcaption className="text-muted p-2 text-xs">
              Document (recto)
            </figcaption>
          </figure>
        </div>

        {(urls.docBack || urls.selfieFrames.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {urls.docBack && (
              <figure className="border-border bg-surface overflow-hidden rounded-lg border">
                {/* eslint-disable-next-line @next/next/no-img-element -- URL signée éphémère */}
                <img
                  src={urls.docBack}
                  alt="Verso du document"
                  className="max-h-[300px] w-full bg-black object-contain"
                />
                <figcaption className="text-muted p-2 text-xs">
                  Document (verso)
                </figcaption>
              </figure>
            )}
            {urls.selfieFrames.length > 0 && (
              <div className="border-border bg-surface rounded-lg border p-2">
                <p className="text-muted mb-1.5 text-xs">
                  Étapes de présence réelle ({urls.selfieFrames.length})
                </p>
                <div className="flex gap-2 overflow-x-auto">
                  {urls.selfieFrames.map((u, i) => (
                    // eslint-disable-next-line @next/next/no-img-element -- URL signée éphémère
                    <img
                      key={u}
                      src={u}
                      alt={`Étape ${i + 1} du selfie`}
                      className="rounded-control h-28 bg-black object-contain"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Informations extraites ───────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Informations extraites</h3>
        <div className="border-border bg-surface rounded-lg border p-4">
          {Object.keys(extracted).length === 0 ? (
            <p className="text-muted text-sm">
              Aucune donnée extraite (document sans MRZ ou lecture impossible).
            </p>
          ) : (
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {Object.entries(extracted).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-3 text-sm">
                  <dt className="text-muted">{FIELD_LABELS[key] ?? key}</dt>
                  <dd className="text-right font-medium">
                    {value == null ? "—" : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {v.document_expires_at && (
            <p
              className={`mt-3 text-xs ${expired ? "text-danger-600 font-semibold" : "text-muted"}`}
            >
              Document {expired ? "EXPIRÉ" : "valide"} — expiration{" "}
              {v.document_expires_at}
            </p>
          )}
        </div>
      </section>

      {/* ── Contrôles ────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Contrôles exécutés</h3>
        <div className="border-border bg-surface overflow-hidden rounded-lg border">
          <ul className="divide-border divide-y">
            {checks.length === 0 && (
              <li className="text-muted p-4 text-sm">Aucun contrôle.</li>
            )}
            {checks.map((c) => {
              const meta = CHECK_STATUS[c.status] ?? CHECK_STATUS.skipped;
              return (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {IDV_CHECK_LABELS_FR[
                        c.check_key as keyof typeof IDV_CHECK_LABELS_FR
                      ] ?? c.check_key}
                    </p>
                    <p className="text-muted text-xs">
                      tentative {c.attempt} ·{" "}
                      {dtf.format(new Date(c.created_at))}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {c.score != null && (
                      <span className="text-sm font-semibold tabular-nums">
                        {Math.round(Number(c.score) * 100)} %
                      </span>
                    )}
                    <span
                      className={`text-caption rounded-full px-2 py-0.5 font-medium ${meta.tone}`}
                    >
                      {meta.label}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* ── Décision ─────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Décision</h3>
        <IdvDecisionPanel id={v.id} closed={closed} />
      </section>

      {/* ── Journal d'audit ──────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Historique</h3>
        <div className="border-border bg-surface overflow-hidden rounded-lg border">
          <ul className="divide-border divide-y">
            {audit.length === 0 && (
              <li className="text-muted p-4 text-sm">Aucun événement.</li>
            )}
            {audit.map((a) => (
              <li key={a.id} className="space-y-0.5 p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium">
                    {AUDIT_ACTIONS[a.action] ?? a.action}
                  </span>
                  <span className="text-muted text-xs">
                    {dtf.format(new Date(a.created_at))}
                    {a.actor_email ? ` · ${a.actor_email}` : ` · système`}
                  </span>
                </div>
                {a.reason && (
                  <p className="text-muted text-xs break-words">{a.reason}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
