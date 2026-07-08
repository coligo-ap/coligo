"use client";

import { useState, useTransition } from "react";
import {
  BadgeCheck,
  Download,
  Eye,
  ExternalLink,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Visualiseur de documents du SUPER-ADMIN (pièces livreur / chauffeur) :
 * aperçu inline image ou PDF SANS téléchargement forcé, bouton Télécharger,
 * et décision directement depuis le visualiseur — Valider / Refuser avec note
 * (prédéfinie ou libre) transmise à l'utilisateur (push + statut sur sa pièce).
 */

/** Motifs de refus fréquents — un tap les insère dans la note. */
export const PREDEFINED_REJECT_NOTES = [
  "Photo illisible ou floue — reprenez la photo.",
  "Document coupé — il doit apparaître en entier.",
  "Document expiré — fournissez un document en cours de validité.",
  "Ce n'est pas le document demandé.",
  "Les informations ne correspondent pas à votre profil.",
  "Photo d'écran refusée — photographiez le document original.",
  "Photo trop sombre — reprenez avec un meilleur éclairage.",
] as const;

/** Notes d'accompagnement possibles pour une validation. */
export const PREDEFINED_APPROVE_NOTES = [
  "Document conforme.",
  "Validé — pensez à le renouveler avant expiration.",
] as const;

type Decision = "approved" | "rejected";

/**
 * Boîte de note de décision : chips de motifs prédéfinis + texte libre.
 * Réutilisée par le visualiseur ET par les boutons inline des listes.
 */
export function DecisionNoteDialog({
  decision,
  docTitle,
  onConfirm,
  onClose,
}: {
  decision: Decision;
  docTitle: string;
  /** Retourne l'erreur éventuelle (affichée inline). */
  onConfirm: (note: string | null) => Promise<{ error?: string }>;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const reject = decision === "rejected";
  const presets = reject ? PREDEFINED_REJECT_NOTES : PREDEFINED_APPROVE_NOTES;

  const confirm = () =>
    start(async () => {
      setError(null);
      if (reject && !note.trim()) {
        setError(
          "Indique le motif du refus (il est transmis à l'utilisateur)."
        );
        return;
      }
      const res = await onConfirm(note.trim() || null);
      if (res.error) setError(res.error);
      else onClose();
    });

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-[16px] bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-bold">
            {reject ? "Refuser" : "Valider"} — {docTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="text-muted hover:text-foreground -m-1 p-1"
          >
            <X className="size-5" />
          </button>
        </div>
        <p className="text-muted mb-3 text-xs">
          {reject
            ? "Le motif est transmis à l'utilisateur (notification + affiché sur sa pièce)."
            : "Note facultative, transmise à l'utilisateur avec la validation."}
        </p>

        <div className="mb-2 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setNote(p)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                note === p
                  ? "border-primary-400 bg-primary-50 text-primary-700"
                  : "border-border hover:bg-surface-2 text-muted"
              )}
            >
              {p}
            </button>
          ))}
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={300}
          placeholder={
            reject ? "Motif (modifiable librement)…" : "Note (optionnelle)…"
          }
          className="border-border focus:border-primary-400 w-full resize-y rounded-[10px] border px-3 py-2 text-sm outline-none"
        />

        {error && (
          <p className="text-danger-600 mt-1 text-xs font-semibold">{error}</p>
        )}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={confirm}
            className={cn(
              "inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-sm font-bold text-white disabled:opacity-50",
              reject ? "bg-danger-600" : "bg-success-600"
            )}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : reject ? (
              <X className="size-4" />
            ) : (
              <BadgeCheck className="size-4" />
            )}
            {reject ? "Confirmer le refus" : "Confirmer la validation"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="border-border hover:bg-surface-2 h-10 rounded-[10px] border px-4 text-sm font-semibold"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Bouton « Voir » + visualiseur plein écran. `getUrl` est appelé à l'ouverture
 * (URL signée fraîche, bucket privé). Si `onDecide` est fourni, le visualiseur
 * porte les boutons Valider / Refuser (→ DecisionNoteDialog).
 */
export function AdminDocViewer({
  docTitle,
  getUrl,
  onDecide,
  triggerClassName,
  triggerLabel = "Voir",
}: {
  docTitle: string;
  getUrl: () => Promise<{ url?: string; error?: string }>;
  onDecide?: (
    status: Decision,
    note: string | null
  ) => Promise<{ error?: string }>;
  triggerClassName?: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [pending, start] = useTransition();

  const show = () =>
    start(async () => {
      setError(null);
      const res = await getUrl();
      if (!res.url) {
        setError(res.error ?? "Document introuvable");
        return;
      }
      setUrl(res.url);
      setOpen(true);
    });

  const isPdf = url ? /\.pdf(\?|#|$)/i.test(url.split("?")[0]) : false;
  // `?download=` force le Content-Disposition attachment sur les URLs
  // signées Supabase Storage.
  const downloadUrl = url
    ? `${url}${url.includes("?") ? "&" : "?"}download=`
    : null;

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={show}
        className={
          triggerClassName ??
          "border-border hover:bg-surface-2 inline-flex items-center gap-1 rounded-[8px] border px-2 py-1 text-xs font-semibold"
        }
      >
        {pending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Eye className="size-3" />
        )}
        {triggerLabel}
      </button>
      {error && (
        <span className="text-danger-600 text-xs font-semibold">{error}</span>
      )}

      {open && url && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/85">
          {/* Barre du haut : titre + actions fichier */}
          <div className="flex items-center gap-2 p-3 text-white">
            <p className="min-w-0 flex-1 truncate text-sm font-bold">
              {docTitle}
            </p>
            <a
              href={downloadUrl ?? "#"}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25"
            >
              <Download className="size-3.5" /> Télécharger
            </a>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Ouvrir dans un onglet"
              className="inline-flex items-center rounded-[8px] bg-white/15 p-1.5 hover:bg-white/25"
            >
              <ExternalLink className="size-3.5" />
            </a>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fermer"
              className="inline-flex items-center rounded-[8px] bg-white/15 p-1.5 hover:bg-white/25"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Document : image contenue ou PDF dans une iframe */}
          <div
            className="min-h-0 flex-1 overflow-auto p-3 pt-0"
            onClick={() => setOpen(false)}
          >
            {isPdf ? (
              <iframe
                src={url}
                title={docTitle}
                className="h-full w-full rounded-[10px] bg-white"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={docTitle}
                className="mx-auto max-h-full rounded-[10px] object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            )}
          </div>

          {/* Barre de décision */}
          {onDecide && (
            <div className="flex gap-2 p-3 pt-0">
              <button
                type="button"
                onClick={() => setDecision("approved")}
                className="bg-success-600 inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[12px] text-sm font-bold text-white"
              >
                <BadgeCheck className="size-4" /> Valider
              </button>
              <button
                type="button"
                onClick={() => setDecision("rejected")}
                className="bg-danger-600 inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[12px] text-sm font-bold text-white"
              >
                <X className="size-4" /> Refuser
              </button>
            </div>
          )}
        </div>
      )}

      {decision && onDecide && (
        <DecisionNoteDialog
          decision={decision}
          docTitle={docTitle}
          onConfirm={async (note) => {
            const res = await onDecide(decision, note);
            if (!res.error) setOpen(false);
            return res;
          }}
          onClose={() => setDecision(null)}
        />
      )}
    </>
  );
}
