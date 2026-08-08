"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, MessageSquarePlus, RefreshCcw, X } from "lucide-react";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import {
  addIdvNote,
  decideIdvCase,
  requestIdvResubmit,
  type ReviewState,
} from "@/app/admin/(confiance)/identite/dossiers/actions";

const initial: ReviewState = {};

/**
 * Panneau de DÉCISION d'un dossier IDV : approuver, refuser (motif
 * obligatoire), redemander un document ou un selfie (message vu par le
 * livreur), commentaire interne. Chaque action a son propre `pending`
 * (jamais un état global qui bloque la page).
 */
export function IdvDecisionPanel({
  id,
  closed,
}: {
  id: string;
  /** Dossier déjà tranché : lecture seule. */
  closed: boolean;
}) {
  const router = useRouter();
  const [decideState, decideAction, decidePending] = useActionState(
    decideIdvCase,
    initial
  );
  const [resubmitState, resubmitAction, resubmitPending] = useActionState(
    requestIdvResubmit,
    initial
  );
  const [noteState, noteAction, notePending] = useActionState(
    addIdvNote,
    initial
  );

  const [reason, setReason] = useState("");
  const [resubmitReason, setResubmitReason] = useState("");
  const [note, setNote] = useState("");
  const [intent, setIntent] = useState<"approve" | "reject">("approve");
  const [what, setWhat] = useState<"document" | "selfie">("document");

  const decideFb = useFormActionFeedback({
    pending: decidePending,
    ok: decideState.ok,
    error: decideState.error,
  });
  const resubmitFb = useFormActionFeedback({
    pending: resubmitPending,
    ok: resubmitState.ok,
    error: resubmitState.error,
  });
  const noteFb = useFormActionFeedback({
    pending: notePending,
    ok: noteState.ok,
    error: noteState.error,
  });

  useEffect(() => {
    if (decideState.ok || resubmitState.ok || noteState.ok) router.refresh();
    if (noteState.ok) setNote("");
  }, [decideState, resubmitState, noteState, router]);

  if (closed) {
    return (
      <div className="border-border bg-surface rounded-lg border p-4">
        <p className="text-muted text-sm">
          Dossier clos — plus aucune action possible. L&apos;historique complet
          reste consultable ci-dessous.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Approuver / refuser. */}
      <form
        action={decideAction}
        className="border-border bg-surface space-y-3 rounded-lg border p-4"
      >
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value={intent} />
        <p className="font-semibold">Décision</p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIntent("approve")}
            className={`rounded-control flex flex-1 items-center justify-center gap-1.5 border px-3 py-2 text-sm font-medium transition-colors ${
              intent === "approve"
                ? "border-success-500 bg-success-50 text-success-700"
                : "border-border text-muted hover:bg-surface-2"
            }`}
          >
            <Check className="size-4" />
            Approuver
          </button>
          <button
            type="button"
            onClick={() => setIntent("reject")}
            className={`rounded-control flex flex-1 items-center justify-center gap-1.5 border px-3 py-2 text-sm font-medium transition-colors ${
              intent === "reject"
                ? "border-danger-500 bg-danger-50 text-danger-700"
                : "border-border text-muted hover:bg-surface-2"
            }`}
          >
            <X className="size-4" />
            Refuser
          </button>
        </div>

        <textarea
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder={
            intent === "reject"
              ? "Motif du refus (obligatoire, tracé au journal)"
              : "Commentaire (facultatif)"
          }
          className="border-border bg-surface rounded-control w-full border p-2.5 text-sm"
        />

        {decideState.error && (
          <p className="text-danger-600 text-sm">{decideState.error}</p>
        )}
        <div className="flex justify-end">
          <ActionButton
            type="submit"
            size="sm"
            state={decideFb}
            disabled={intent === "reject" && reason.trim().length < 3}
            labels={{
              idle: intent === "approve" ? "Valider l'identité" : "Refuser",
              success: "Enregistré ✓",
            }}
          />
        </div>
      </form>

      {/* Redemander une pièce. */}
      <form
        action={resubmitAction}
        className="border-border bg-surface space-y-3 rounded-lg border p-4"
      >
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="what" value={what} />
        <p className="flex items-center gap-1.5 font-semibold">
          <RefreshCcw className="size-4" />
          Demander une nouvelle pièce
        </p>

        <div className="flex gap-2">
          {(
            [
              ["document", "Nouveau document"],
              ["selfie", "Nouveau selfie"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setWhat(value)}
              className={`rounded-control flex-1 border px-3 py-2 text-sm font-medium transition-colors ${
                what === value
                  ? "border-primary-500 bg-primary-50 text-primary-700"
                  : "border-border text-muted hover:bg-surface-2"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <textarea
          name="reason"
          value={resubmitReason}
          onChange={(e) => setResubmitReason(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Ce qui ne va pas — ce texte est envoyé au livreur"
          className="border-border bg-surface rounded-control w-full border p-2.5 text-sm"
        />

        {resubmitState.error && (
          <p className="text-danger-600 text-sm">{resubmitState.error}</p>
        )}
        <div className="flex justify-end">
          <ActionButton
            type="submit"
            size="sm"
            variant="outline"
            state={resubmitFb}
            disabled={resubmitReason.trim().length < 3}
            labels={{ idle: "Envoyer la demande", success: "Demandé ✓" }}
          />
        </div>
      </form>

      {/* Commentaire interne. */}
      <form
        action={noteAction}
        className="border-border bg-surface space-y-3 rounded-lg border p-4"
      >
        <input type="hidden" name="id" value={id} />
        <p className="flex items-center gap-1.5 font-semibold">
          <MessageSquarePlus className="size-4" />
          Commentaire interne
        </p>
        <textarea
          name="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Visible uniquement par l'équipe Coligo (journal d'audit)"
          className="border-border bg-surface rounded-control w-full border p-2.5 text-sm"
        />
        {noteState.error && (
          <p className="text-danger-600 text-sm">{noteState.error}</p>
        )}
        <div className="flex justify-end">
          <ActionButton
            type="submit"
            size="sm"
            variant="outline"
            state={noteFb}
            disabled={note.trim().length < 2}
            labels={{ idle: "Ajouter", success: "Ajouté ✓" }}
          />
        </div>
      </form>
    </div>
  );
}
