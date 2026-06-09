"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { resolveDriverChangeRequest } from "@/app/admin/drivers/actions";

export type ChangeRequest = {
  id: string;
  kind: string;
  note: string;
  status: string;
  review_note: string | null;
  created_at: string;
};

/**
 * Demandes de modification soumises par le livreur (compte vérifié). Le
 * super-admin VÉRIFIE puis applique le changement via les sections de la fiche,
 * et marque la demande approuvée/refusée ici (traçabilité + anti-fraude).
 */
export function DriverChangeRequests({
  driverId,
  requests,
}: {
  driverId: string;
  requests: ChangeRequest[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const resolve = (requestId: string, decision: "approved" | "rejected") =>
    start(async () => {
      const reviewNote =
        prompt(
          decision === "approved"
            ? "Note (optionnel) — confirmez avoir appliqué le changement :"
            : "Motif du refus (optionnel) :"
        ) ?? undefined;
      const r = await resolveDriverChangeRequest({
        requestId,
        driverId,
        decision,
        reviewNote,
      });
      if (r.error) toast.error(r.error);
      else {
        toast.success(
          decision === "approved" ? "Demande approuvée" : "Demande refusée"
        );
        router.refresh();
      }
    });

  if (requests.length === 0) {
    return <p className="text-muted text-sm">Aucune demande.</p>;
  }

  const statusPill = (s: string) =>
    s === "approved"
      ? "bg-success-50 text-success-700"
      : s === "rejected"
        ? "bg-danger-50 text-danger-700"
        : "bg-warning-50 text-warning-700";

  return (
    <ul className="space-y-3">
      {requests.map((r) => (
        <li key={r.id} className="border-border rounded-[12px] border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold capitalize">{r.kind}</p>
              <p className="text-muted text-sm">{r.note}</p>
              {r.review_note && (
                <p className="text-muted mt-1 text-xs">
                  Note : {r.review_note}
                </p>
              )}
              <p className="text-subtle mt-1 text-xs">
                {new Date(r.created_at).toLocaleString("fr-FR")}
              </p>
            </div>
            <span
              className={
                "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold " +
                statusPill(r.status)
              }
            >
              {r.status === "approved"
                ? "Approuvée"
                : r.status === "rejected"
                  ? "Refusée"
                  : "En attente"}
            </span>
          </div>
          {r.status === "pending" && (
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                type="button"
                disabled={pending}
                onClick={() => resolve(r.id, "approved")}
              >
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                Approuver
              </Button>
              <Button
                size="sm"
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={() => resolve(r.id, "rejected")}
              >
                <X className="size-3.5" />
                Refuser
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
