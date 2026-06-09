"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import {
  upsertDriverDocument,
  deleteDriverDocument,
} from "@/app/admin/drivers/actions";
import type { AdminFormState } from "@/app/admin/actions";

export type DriverDocument = {
  id: string;
  doc_type: string;
  number: string | null;
  issued_at: string | null;
  expires_at: string | null;
  note: string | null;
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

export function DriverDocumentsManager({
  driverId,
  documents,
}: {
  driverId: string;
  documents: DriverDocument[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [delPending, startDel] = useTransition();
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(
    upsertDriverDocument.bind(null, driverId),
    {}
  );

  useEffect(() => {
    if (state.ok) {
      toast.success("Pièce enregistrée");
      setAdding(false);
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <div className="space-y-3">
      {documents.length === 0 && (
        <p className="text-muted text-sm">Aucune pièce enregistrée.</p>
      )}

      {documents.map((d) => (
        <div
          key={d.id}
          className="border-border flex items-start justify-between gap-3 rounded-[12px] border p-3"
        >
          <div className="min-w-0 text-sm">
            <p className="font-semibold">{docLabel(d.doc_type)}</p>
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
          </div>
          <button
            type="button"
            aria-label="Supprimer"
            className="text-danger-600 hover:bg-danger-50 rounded-[8px] p-1.5"
            disabled={delPending}
            onClick={() => {
              if (!confirm("Supprimer cette pièce ?")) return;
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
      ))}

      {adding ? (
        <form
          action={formAction}
          className="border-border space-y-3 rounded-[12px] border border-dashed p-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="doc_type" className="mb-1 block text-xs">
                Type de pièce *
              </Label>
              <select
                id="doc_type"
                name="doc_type"
                required
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
              <Input id="number" name="number" />
            </div>
            <div>
              <Label htmlFor="issued_at" className="mb-1 block text-xs">
                Date d&apos;émission
              </Label>
              <Input id="issued_at" name="issued_at" type="date" />
            </div>
            <div>
              <Label htmlFor="expires_at" className="mb-1 block text-xs">
                Date d&apos;expiration
              </Label>
              <Input id="expires_at" name="expires_at" type="date" />
            </div>
          </div>
          <div>
            <Label htmlFor="note" className="mb-1 block text-xs">
              Note
            </Label>
            <Input id="note" name="note" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Ajouter
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setAdding(false)}
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
          onClick={() => setAdding(true)}
        >
          <Plus className="size-4" />
          Ajouter une pièce
        </Button>
      )}
    </div>
  );
}
