"use client";

import { useState, useTransition } from "react";
import { BadgeCheck, Loader2, X } from "lucide-react";
import { usePrompt } from "@/components/ui/confirm";
import { AdminDocViewer } from "@/components/admin/doc-viewer";
import {
  approveChauffeurGated,
  getChauffeurDocUrl,
  rejectChauffeur,
  approveSubPayment,
  rejectSubPayment,
} from "@/app/admin/chauffeurs/actions";

const DOC_LABEL: Record<string, string> = {
  permis_recto: "Permis (recto)",
  permis_verso: "Permis (verso)",
  carte_grise: "Carte grise",
  plaque: "Plaque",
  assurance: "Assurance",
  selfie: "Selfie",
};

/** File de validation : docs + selfie, approuver / refuser avec motif. */
export function ChauffeurValidationCard({
  chauffeur,
  docs,
}: {
  chauffeur: {
    id: string;
    full_name: string;
    phone: string;
    city: string | null;
    gamme: string;
    birth_date: string | null;
    submitted_at: string | null;
  };
  docs: { kind: string; url: string }[];
}) {
  const prompt = usePrompt();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (done) {
    return (
      <div className="border-border bg-surface rounded-[14px] border p-4 text-sm font-semibold">
        {done}
      </div>
    );
  }

  return (
    <div className="border-warning-300 bg-surface rounded-[14px] border-2 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="font-bold">{chauffeur.full_name}</p>
        <span className="text-muted text-xs tabular-nums">
          {chauffeur.phone}
        </span>
        <span className="bg-primary-50 text-primary-700 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase">
          {chauffeur.gamme}
        </span>
        {chauffeur.city && (
          <span className="text-muted text-xs">{chauffeur.city}</span>
        )}
        {chauffeur.birth_date && (
          <span className="text-muted text-xs">
            né(e) le {chauffeur.birth_date}
          </span>
        )}
        {chauffeur.submitted_at && (
          <span className="text-muted ml-auto text-xs">
            dossier du{" "}
            {new Date(chauffeur.submitted_at).toLocaleDateString("fr-FR")}
          </span>
        )}
      </div>

      <a
        href={`/admin/chauffeurs/${chauffeur.id}`}
        className="text-primary-700 mb-2 inline-block text-xs font-bold hover:underline"
      >
        Ouvrir la fiche — valider les pièces une à une →
      </a>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {docs.length === 0 && (
          <span className="text-muted text-xs">Aucun document reçu.</span>
        )}
        {docs.map((d) => (
          <AdminDocViewer
            key={d.kind}
            docTitle={DOC_LABEL[d.kind] ?? d.kind}
            getUrl={() => getChauffeurDocUrl(d.url)}
            triggerLabel={DOC_LABEL[d.kind] ?? d.kind}
            triggerClassName="border-border hover:bg-surface-2 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold"
          />
        ))}
      </div>

      {error && (
        <p className="text-danger-600 mb-2 text-xs font-semibold">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              // Version GATÉE : refuse tant que les pièces obligatoires ne
              // sont pas validées une à une (fiche détail).
              const res = await approveChauffeurGated(chauffeur.id);
              if (res.error) setError(res.error);
              else
                setDone(
                  `✓ ${chauffeur.full_name} approuvé — il peut recevoir des courses.`
                );
            })
          }
          className="bg-success-600 inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-xs font-bold text-white disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <BadgeCheck className="size-3.5" />
          )}
          Approuver
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const motif = await prompt({
                title: "Refuser le dossier",
                message: "Motif du refus (affiché au chauffeur).",
                initialValue: "Documents illisibles — reprenez les photos.",
                multiline: true,
              });
              if (!motif) return;
              const res = await rejectChauffeur(chauffeur.id, motif);
              if (res.error) setError(res.error);
              else
                setDone(
                  `Dossier de ${chauffeur.full_name} refusé (motif transmis).`
                );
            })
          }
          className="bg-danger-600 inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-xs font-bold text-white disabled:opacity-50"
        >
          <X className="size-3.5" /> Refuser (motif)
        </button>
      </div>
    </div>
  );
}

/** Vérification d'un paiement d'abonnement CCP (24 h). */
export function SubPaymentActions({ paymentId }: { paymentId: string }) {
  const prompt = usePrompt();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (done)
    return <span className="text-success-700 text-xs font-bold">{done}</span>;

  return (
    <span className="inline-flex items-center gap-1.5">
      {error && <span className="text-danger-600 text-xs">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await approveSubPayment(paymentId);
            if (res.error) setError(res.error);
            else setDone("Activé ✓");
          })
        }
        className="bg-success-600 rounded-[8px] px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"
      >
        {pending ? "…" : "Reçu OK · activer"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const note = await prompt({
              title: "Rejeter ce paiement",
              message: "Motif du rejet.",
              initialValue: "Virement introuvable",
            });
            if (note == null) return;
            const res = await rejectSubPayment(paymentId, note);
            if (res.error) setError(res.error);
            else setDone("Rejeté");
          })
        }
        className="bg-danger-600 rounded-[8px] px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"
      >
        Rejeter
      </button>
    </span>
  );
}
