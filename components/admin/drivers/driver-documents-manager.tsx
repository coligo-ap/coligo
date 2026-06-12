"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Plus,
  Trash2,
  AlertTriangle,
  Pencil,
  Paperclip,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import {
  upsertDriverDocument,
  deleteDriverDocument,
  setDriverDocumentStatus,
} from "@/app/admin/drivers/actions";
import {
  AdminDocViewer,
  DecisionNoteDialog,
} from "@/components/admin/doc-viewer";
import type { AdminFormState } from "@/app/admin/actions";

export type DriverDocument = {
  id: string;
  doc_type: string;
  number: string | null;
  issued_at: string | null;
  expires_at: string | null;
  note: string | null;
  hasScan: boolean;
  scanUrl: string | null;
  status: string;
  review_note: string | null;
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: {
    label: "⏳ En vérification",
    cls: "bg-warning-50 text-warning-700",
  },
  approved: { label: "✓ Vérifiée", cls: "bg-success-50 text-success-700" },
  rejected: { label: "Refusée", cls: "bg-danger-50 text-danger-700" },
};

const DOC_TYPES = [
  ["cni", "Carte d'identité"],
  ["permis", "Permis de conduire"],
  ["carte_grise", "Carte grise"],
  ["passeport", "Passeport"],
  ["autre", "Autre"],
] as const;

const docLabel = (t: string) => DOC_TYPES.find(([v]) => v === t)?.[1] ?? t;

function isExpired(d: string | null) {
  if (!d) return false;
  return new Date(d) < new Date(new Date().toDateString());
}

// `null` = aucun formulaire ; "new" = ajout ; sinon = édition de cette pièce.
type Editing = null | "new" | DriverDocument;

export function DriverDocumentsManager({
  driverId,
  documents,
}: {
  driverId: string;
  documents: DriverDocument[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  // Pièce en cours de refus (boîte de motif prédéfini/libre).
  const [rejecting, setRejecting] = useState<{
    docId: string;
    label: string;
  } | null>(null);
  const [delPending, startDel] = useTransition();
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(
    upsertDriverDocument.bind(null, driverId),
    {}
  );

  useEffect(() => {
    if (state.ok) {
      toast.success("Pièce enregistrée");
      setEditing(null);
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  const doc = editing && editing !== "new" ? editing : null;

  return (
    <div className="space-y-3">
      {documents.length === 0 && editing === null && (
        <p className="text-muted text-sm">Aucune pièce enregistrée.</p>
      )}

      {documents.map((d) =>
        // La pièce en cours d'édition est masquée au profit du formulaire.
        editing && editing !== "new" && editing.id === d.id ? null : (
          <div
            key={d.id}
            className="border-border flex items-start justify-between gap-3 rounded-[12px] border p-3"
          >
            <div className="min-w-0 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                {docLabel(d.doc_type)}
                <span
                  className={
                    "rounded-full px-2 py-0.5 text-[10px] font-bold " +
                    (STATUS_META[d.status]?.cls ?? "bg-surface-2 text-muted")
                  }
                >
                  {STATUS_META[d.status]?.label ?? d.status}
                </span>
              </p>
              <p className="text-muted tabular-nums">
                {d.number ?? "N° non renseigné"}
              </p>
              <p className="text-muted text-xs tabular-nums">
                {d.issued_at ? `Émise le ${d.issued_at}` : "—"}
                {d.expires_at && (
                  <span
                    className={
                      isExpired(d.expires_at)
                        ? "text-danger-600 font-semibold"
                        : ""
                    }
                  >
                    {" · "}
                    {isExpired(d.expires_at) ? "Expirée le " : "Expire le "}
                    {d.expires_at}
                    {isExpired(d.expires_at) && (
                      <AlertTriangle className="ml-1 inline size-3" />
                    )}
                  </span>
                )}
              </p>
              {d.note && <p className="text-muted mt-0.5 text-xs">{d.note}</p>}
              {d.review_note && (
                <p className="text-danger-600 mt-0.5 text-xs">
                  Note : {d.review_note}
                </p>
              )}
              {d.scanUrl && (
                <span className="mt-1 inline-flex">
                  {/* Visualiseur : aperçu inline + Télécharger + décision */}
                  <AdminDocViewer
                    docTitle={docLabel(d.doc_type)}
                    getUrl={async () => ({ url: d.scanUrl ?? undefined })}
                    onDecide={async (status, note) => {
                      const r = await setDriverDocumentStatus(
                        driverId,
                        d.id,
                        status,
                        note
                      );
                      if (!r.error) router.refresh();
                      return r;
                    }}
                    triggerLabel="Voir le scan"
                    triggerClassName="text-primary-700 inline-flex items-center gap-1 text-xs font-semibold hover:underline"
                  />
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-start gap-1">
              {d.status === "pending" && (
                <>
                  <button
                    type="button"
                    aria-label="Valider la pièce"
                    className="text-success-700 hover:bg-success-50 rounded-[8px] p-1.5"
                    disabled={delPending}
                    onClick={() => {
                      startDel(async () => {
                        const r = await setDriverDocumentStatus(
                          driverId,
                          d.id,
                          "approved"
                        );
                        if (r.error) toast.error(r.error);
                        else {
                          toast.success("Pièce validée");
                          router.refresh();
                        }
                      });
                    }}
                  >
                    <Check className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Refuser la pièce"
                    className="text-danger-600 hover:bg-danger-50 rounded-[8px] p-1.5"
                    disabled={delPending}
                    onClick={() =>
                      setRejecting({
                        docId: d.id,
                        label: docLabel(d.doc_type),
                      })
                    }
                  >
                    <X className="size-4" />
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label="Modifier"
                className="text-muted hover:bg-surface-2 rounded-[8px] p-1.5"
                onClick={() => setEditing(d)}
              >
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Supprimer"
                className="text-danger-600 hover:bg-danger-50 rounded-[8px] p-1.5"
                disabled={delPending}
                onClick={() => {
                  if (!confirm("Supprimer cette pièce et son scan ?")) return;
                  startDel(async () => {
                    const r = await deleteDriverDocument(driverId, d.id);
                    if (r.error) toast.error(r.error);
                    else {
                      toast.success("Pièce supprimée");
                      router.refresh();
                    }
                  });
                }}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </div>
        )
      )}

      {editing !== null ? (
        <form
          key={editing === "new" ? "new" : editing.id}
          action={formAction}
          className="border-border space-y-3 rounded-[12px] border border-dashed p-3"
        >
          {doc && <input type="hidden" name="doc_id" value={doc.id} />}
          <p className="text-muted text-xs font-semibold uppercase">
            {doc ? `Modifier — ${docLabel(doc.doc_type)}` : "Nouvelle pièce"}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="doc_type" className="mb-1 block text-xs">
                Type de pièce *
              </Label>
              <select
                id="doc_type"
                name="doc_type"
                required
                defaultValue={doc?.doc_type ?? "cni"}
                className="border-border bg-surface h-10 w-full rounded-[10px] border px-3 text-sm"
              >
                {DOC_TYPES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="number" className="mb-1 block text-xs">
                Numéro
              </Label>
              <Input
                id="number"
                name="number"
                defaultValue={doc?.number ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="issued_at" className="mb-1 block text-xs">
                Date d&apos;émission
              </Label>
              <Input
                id="issued_at"
                name="issued_at"
                type="date"
                defaultValue={doc?.issued_at ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="expires_at" className="mb-1 block text-xs">
                Date d&apos;expiration
              </Label>
              <Input
                id="expires_at"
                name="expires_at"
                type="date"
                defaultValue={doc?.expires_at ?? ""}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="note" className="mb-1 block text-xs">
              Note
            </Label>
            <Input id="note" name="note" defaultValue={doc?.note ?? ""} />
          </div>
          <div>
            <Label htmlFor="file" className="mb-1 block text-xs">
              Scan (JPG, PNG, WEBP ou PDF — max 8 Mo)
            </Label>
            <input
              id="file"
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="border-border file:bg-surface-2 block w-full rounded-[10px] border text-sm file:mr-3 file:border-0 file:px-3 file:py-2 file:text-sm"
            />
            {doc?.hasScan && (
              <p className="text-muted mt-1 flex items-center gap-1 text-xs">
                <Paperclip className="size-3" />
                Un scan existe déjà — en choisir un nouveau le remplace.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {doc ? "Enregistrer" : "Ajouter"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setEditing(null)}
            >
              Annuler
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setEditing("new")}
        >
          <Plus className="size-4" />
          Ajouter une pièce
        </Button>
      )}

      {/* Boîte de motif (refus inline) — motifs prédéfinis + texte libre */}
      {rejecting && (
        <DecisionNoteDialog
          decision="rejected"
          docTitle={rejecting.label}
          onConfirm={async (note) => {
            const r = await setDriverDocumentStatus(
              driverId,
              rejecting.docId,
              "rejected",
              note
            );
            if (!r.error) {
              toast.success("Pièce refusée — motif transmis au livreur");
              router.refresh();
            }
            return r;
          }}
          onClose={() => setRejecting(null)}
        />
      )}
    </div>
  );
}
