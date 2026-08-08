"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban,
  Banknote,
  Car,
  Check,
  CreditCard,
  Loader2,
  MapPin,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDA } from "@/lib/utils";
import {
  adminCancelRide,
  adminCompleteRide,
  type StuckRide,
} from "@/app/admin/drive/actions";

// =============================================================================
// Courses Drive BLOQUÉES (mig 0342) — panneau de décision support :
//  - attribuées sans progression (chauffeur accepté qui ne démarre pas, course
//    démarrée jamais terminée) → Clôturer comme terminée (chauffeur payé) ou
//    Annuler (+ remboursement séquestre) ;
//  - recherches payées CARTE expirées → Annuler = recrédit Coligo Pay immédiat.
// Motif obligatoire, tout est audité, chauffeur + client notifiés.
// =============================================================================

const STATUS_LABEL: Record<string, string> = {
  searching: "Recherche",
  accepted: "Acceptée",
  arriving: "En approche",
  arrived: "Chauffeur arrivé",
  in_progress: "En course",
  scheduled: "Programmée",
};

export function StuckRidesPanel({ rides }: { rides: StuckRide[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [modal, setModal] = useState<{
    rideId: string;
    action: "cancel" | "complete";
  } | null>(null);
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  if (rides.length === 0) {
    return (
      <section className="border-border bg-surface rounded-card-lg border p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Car className="size-4" />
          Courses à trancher
        </h2>
        <p className="text-muted mt-1 text-xs">
          Aucune course bloquée. Les courses attribuées sans progression et les
          recherches payées carte expirées apparaîtront ici (et dans les
          alertes).
        </p>
      </section>
    );
  }

  const run = (
    fn: () => Promise<{ ok?: boolean; error?: string }>,
    okMsg: string
  ) =>
    start(async () => {
      const res = await fn();
      if (res.error) setFeedback({ tone: "error", text: res.error });
      else {
        setFeedback({ tone: "ok", text: okMsg });
        setModal(null);
        setReason("");
      }
      router.refresh();
    });

  return (
    <section className="border-warning-200 bg-surface rounded-card-lg border p-4">
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <Car className="size-4" />
        Courses à trancher ({rides.length})
      </h2>
      <p className="text-muted mt-1 text-xs">
        Bloquées sans progression ou payées carte et expirées. Clôturer paie le
        chauffeur comme une course terminée ; annuler recrédite le séquestre au
        client. Motif obligatoire, action tracée, les deux parties sont
        notifiées.
      </p>

      {feedback && (
        <p
          className={
            "rounded-control mt-2 px-3 py-2 text-xs font-semibold " +
            (feedback.tone === "ok"
              ? "bg-success-100 text-success-700"
              : "bg-danger-100 text-danger-700")
          }
        >
          {feedback.text}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {rides.map((r) => (
          <li
            key={r.id}
            className="border-border bg-surface-2 rounded-md border p-3"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={r.kind === "card_expired" ? "danger" : "warning"}>
                {r.kind === "card_expired"
                  ? "Carte payée · expirée"
                  : (STATUS_LABEL[r.status] ?? r.status)}
              </Badge>
              <span className="text-sm font-bold tabular-nums">
                {formatDA(r.priceDa)}
              </span>
              <span className="text-muted inline-flex items-center gap-1 text-xs">
                {r.paymentMethod === "cash" ? (
                  <Banknote className="size-3" />
                ) : (
                  <CreditCard className="size-3" />
                )}
                {r.paymentMethod === "cash"
                  ? "Espèces"
                  : r.paymentMethod === "card"
                    ? "Carte"
                    : "Coligo Pay"}
                {r.escrowDa > 0 ? ` · séquestre ${formatDA(r.escrowDa)}` : ""}
              </span>
              <span className="text-subtle text-caption">
                depuis{" "}
                {new Date(r.sinceAt).toLocaleString("fr-DZ", {
                  timeZone: "Africa/Algiers",
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <p className="text-muted mt-1 flex flex-wrap items-center gap-x-3 text-xs">
              <span className="inline-flex items-center gap-1">
                <User className="size-3" />
                {r.customerName ?? "Client"}
              </span>
              {r.chauffeurName && (
                <span className="inline-flex items-center gap-1">
                  <Car className="size-3" />
                  {r.chauffeurName}
                </span>
              )}
              {(r.pickupText || r.destText) && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" />
                  {[r.pickupText, r.destText].filter(Boolean).join(" → ")}
                </span>
              )}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Link
                href={`/admin/chauffeurs/courses/${r.id}`}
                className="text-primary-700 mr-1 text-xs font-semibold hover:underline"
              >
                Fiche course →
              </Link>
              {r.chauffeurId && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setFeedback(null);
                    setReason("");
                    setModal({ rideId: r.id, action: "complete" });
                  }}
                  className="bg-success-600 hover:bg-success-700 rounded-control inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                >
                  <Check className="size-3.5" />
                  Clôturer comme terminée
                </button>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setFeedback(null);
                  setReason("");
                  setModal({ rideId: r.id, action: "cancel" });
                }}
                className="border-danger-200 text-danger-700 hover:bg-danger-50 rounded-control inline-flex items-center gap-1 border px-3 py-1.5 text-xs font-bold disabled:opacity-50"
              >
                <Ban className="size-3.5" />
                Annuler{r.escrowDa > 0 ? " + rembourser" : ""}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {modal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface rounded-sheet-lg w-full max-w-sm p-5 shadow-2xl">
            <h3 className="text-base font-black">
              {modal.action === "cancel"
                ? "Annuler la course"
                : "Clôturer comme terminée"}
            </h3>
            <p className="text-muted mt-1 text-xs">
              {modal.action === "cancel"
                ? "Le séquestre éventuel (carte / Coligo Pay) est recrédité au client immédiatement."
                : "Le chauffeur est payé comme si la course s'était terminée normalement (commission et cashback appliqués)."}
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 300))}
              rows={2}
              placeholder="Motif (obligatoire, tracé dans l'audit)"
              className="border-border bg-surface-2 text-body-sm mt-3 w-full resize-none rounded-md border px-3 py-2.5 outline-none"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setModal(null)}
                disabled={pending}
                className="border-border text-muted flex-1 rounded-md border py-2.5 text-sm font-bold"
              >
                Retour
              </button>
              <button
                type="button"
                disabled={pending || reason.trim() === ""}
                onClick={() =>
                  modal.action === "cancel"
                    ? run(
                        () =>
                          adminCancelRide({
                            rideId: modal.rideId,
                            reason: reason.trim(),
                          }),
                        "Course annulée — remboursement et notifications envoyés."
                      )
                    : run(
                        () =>
                          adminCompleteRide({
                            rideId: modal.rideId,
                            reason: reason.trim(),
                          }),
                        "Course clôturée — chauffeur payé et notifié."
                      )
                }
                className={
                  "inline-flex flex-1 items-center justify-center gap-1 rounded-md py-2.5 text-sm font-bold text-white disabled:opacity-50 " +
                  (modal.action === "cancel"
                    ? "bg-danger-600 hover:bg-danger-700"
                    : "bg-success-600 hover:bg-success-700")
                }
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : modal.action === "cancel" ? (
                  "Confirmer l'annulation"
                ) : (
                  "Confirmer la clôture"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
