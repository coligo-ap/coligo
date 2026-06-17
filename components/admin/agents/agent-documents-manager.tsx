"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FileWarning, X } from "lucide-react";
import { toast } from "@/components/ui/toast";
import {
  AdminDocViewer,
  DecisionNoteDialog,
} from "@/components/admin/doc-viewer";
import { setAgentDocumentStatus } from "@/app/admin/agents/actions";

export type AgentDocument = {
  id: string;
  kind: string;
  label: string | null;
  status: string;
  review_note: string | null;
  scanUrl: string | null;
  createdAt: string;
};

const KIND_LABEL: Record<string, string> = {
  registre_commerce: "Registre de commerce",
  piece_identite: "Pièce d'identité",
  autre: "Autre document",
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: {
    label: "⏳ En vérification",
    cls: "bg-warning-50 text-warning-700",
  },
  approved: { label: "✓ Validée", cls: "bg-success-50 text-success-700" },
  rejected: { label: "Refusée", cls: "bg-danger-50 text-danger-700" },
};

export function AgentDocumentsManager({
  walletId,
  documents,
}: {
  walletId: string;
  documents: AgentDocument[];
}) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState<{
    docId: string;
    label: string;
  } | null>(null);
  const [, startTransition] = useTransition();

  if (documents.length === 0) {
    return (
      <div className="border-border text-muted flex items-center gap-2 rounded-[12px] border border-dashed p-4 text-sm">
        <FileWarning className="size-4" />
        L&apos;agent n&apos;a encore déposé aucune pièce.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {documents.map((d) => {
        const label = KIND_LABEL[d.kind] ?? d.kind;
        const meta = STATUS_META[d.status];
        return (
          <div
            key={d.id}
            className="border-border flex items-start justify-between gap-3 rounded-[12px] border p-3"
          >
            <div className="min-w-0 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {label}
                {d.label ? (
                  <span className="text-muted font-normal">· {d.label}</span>
                ) : null}
                <span
                  className={
                    "rounded-full px-2 py-0.5 text-[10px] font-bold " +
                    (meta?.cls ?? "bg-surface-2 text-muted")
                  }
                >
                  {meta?.label ?? d.status}
                </span>
              </p>
              {d.review_note && (
                <p className="text-danger-600 mt-0.5 text-xs">
                  Note : {d.review_note}
                </p>
              )}
              {d.scanUrl && (
                <AdminDocViewer
                  docTitle={label}
                  getUrl={async () => ({ url: d.scanUrl ?? undefined })}
                  onDecide={async (status, note) => {
                    const r = await setAgentDocumentStatus(
                      walletId,
                      d.id,
                      status,
                      note
                    );
                    if (!r.error) router.refresh();
                    return r;
                  }}
                  triggerLabel="Voir la pièce"
                />
              )}
            </div>
            {d.status === "pending" && (
              <div className="flex shrink-0 items-start gap-1">
                <button
                  type="button"
                  aria-label="Valider la pièce"
                  className="text-success-700 hover:bg-success-50 rounded-[8px] p-1.5"
                  onClick={() =>
                    startTransition(async () => {
                      const r = await setAgentDocumentStatus(
                        walletId,
                        d.id,
                        "approved"
                      );
                      if (r.error) toast.error(r.error);
                      else {
                        toast.success("Pièce validée");
                        router.refresh();
                      }
                    })
                  }
                >
                  <Check className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Refuser la pièce"
                  className="text-danger-600 hover:bg-danger-50 rounded-[8px] p-1.5"
                  onClick={() => setRejecting({ docId: d.id, label })}
                >
                  <X className="size-4" />
                </button>
              </div>
            )}
          </div>
        );
      })}

      {rejecting && (
        <DecisionNoteDialog
          decision="rejected"
          docTitle={rejecting.label}
          onConfirm={async (note) => {
            const r = await setAgentDocumentStatus(
              walletId,
              rejecting.docId,
              "rejected",
              note
            );
            if (!r.error) {
              toast.success("Pièce refusée — motif transmis à l'agent");
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
