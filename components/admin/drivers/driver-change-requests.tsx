"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { usePrompt } from "@/components/ui/confirm";
import { resolveDriverChangeRequest } from "@/app/admin/drivers/actions";

export type ChangeRequest = {
  id: string;
  kind: string;
  note: string;
  status: string;
  review_note: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

const FIELD_LABELS: Record<string, string> = {
  vehicle_type: "Type",
  vehicle_brand: "Marque",
  vehicle_model: "Modèle",
  vehicle_color: "Couleur",
  vehicle_year: "Année",
  vehicle_plate: "Immatriculation",
  national_id_number: "N° national",
  id_card_number: "N° carte d'identité",
  wilaya: "Wilaya",
  address: "Adresse",
  method: "Moyen",
  label: "Libellé",
  account_number: "N° compte",
  account_name: "Titulaire",
  is_default: "Par défaut",
  doc_type: "Type de pièce",
  number: "Numéro",
  issued_at: "Émission",
  expires_at: "Expiration",
  file_url: "Scan",
};
const fmt = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? "—"
    : typeof v === "boolean"
      ? v
        ? "oui"
        : "non"
      : String(v);

/**
 * Demandes de modification soumises par le livreur (compte vérifié). Le
 * super-admin VÉRIFIE puis applique le changement via les sections de la fiche,
 * et marque la demande approuvée/refusée ici (traçabilité + anti-fraude).
 */
export function DriverChangeRequests({
  driverId,
  requests,
  currentVehicle,
}: {
  driverId: string;
  requests: ChangeRequest[];
  currentVehicle?: Record<string, unknown>;
}) {
  const router = useRouter();
  const prompt = usePrompt();
  const [pending, start] = useTransition();
  const [note, setNote] = useActionNote();

  const resolve = async (
    requestId: string,
    decision: "approved" | "rejected"
  ) => {
    const reviewNote =
      (await prompt({
        title:
          decision === "approved"
            ? "Confirmer le changement appliqué"
            : "Refuser la demande",
        message:
          decision === "approved"
            ? "Note (optionnel) — confirmez avoir appliqué le changement."
            : "Motif du refus (optionnel).",
        multiline: true,
        confirmLabel: decision === "approved" ? "Approuver" : "Refuser",
      })) ?? undefined;
    start(async () => {
      const r = await resolveDriverChangeRequest({
        requestId,
        driverId,
        decision,
        reviewNote,
      });
      // Succès : le statut de la demande change (approuvée/refusée) via refresh.
      if (r.error) setNote({ ok: false, text: r.error });
      else router.refresh();
    });
  };

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
    <>
      <ActionNote note={note} className="mb-2" />
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

            {/* Avant → après : ce que le livreur veut changer. */}
            {r.payload && Object.keys(r.payload).length > 0 && (
              <div className="bg-surface-2 mt-2 rounded-[10px] p-2.5 text-xs">
                {Object.entries(r.payload).map(([k, v]) => {
                  const before = currentVehicle?.[k];
                  const showBefore =
                    r.kind === "vehicle" || r.kind === "profile";
                  return (
                    <div
                      key={k}
                      className="flex items-center justify-between gap-2 py-0.5"
                    >
                      <span className="text-muted">{FIELD_LABELS[k] ?? k}</span>
                      <span className="text-right">
                        {showBefore && (
                          <span className="text-muted line-through">
                            {fmt(before)}
                          </span>
                        )}{" "}
                        <span className="text-foreground font-semibold">
                          {k === "file_url" ? (v ? "fourni" : "—") : fmt(v)}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

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
    </>
  );
}
