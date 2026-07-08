"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, HandCoins, Loader2, Wallet } from "lucide-react";
import { formatDA } from "@/lib/utils";
import {
  adminCancelRide,
  adminCompensateChauffeur,
  adminCompleteRide,
  adminRefundRideCustomer,
} from "@/app/admin/drive/actions";

// =============================================================================
// Panneau d'actions de la FICHE COURSE Drive (parité fiche commande) :
// annuler (+ remboursement séquestre), clôturer comme terminée (chauffeur
// payé), rembourser le client (course terminée, plafonné, anti-double),
// indemniser le chauffeur (crédit motivé de son portefeuille opérateur —
// grand livre immuable admin_operator_credit). Messages INLINE, motif requis.
// =============================================================================

type PanelRide = {
  id: string;
  status: string;
  chauffeurId: string | null;
  chauffeurName: string | null;
  refundRemainingDa: number;
  escrowDa: number;
};

type ModalKind = "cancel" | "complete" | "refund" | "compensate";

export function RideAdminPanel({ ride }: { ride: PanelRide }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [feedback, setFeedback] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const terminal = ride.status === "completed" || ride.status === "cancelled";

  const openModal = (kind: ModalKind) => {
    setFeedback(null);
    setReason("");
    setAmount("");
    setModal(kind);
  };

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
      }
      router.refresh();
    });

  return (
    <section className="border-border bg-surface mt-3 rounded-[14px] border p-4">
      <h2 className="text-muted text-xs font-bold uppercase">Gestion</h2>

      {feedback && (
        <p
          className={
            "mt-2 rounded-[10px] px-3 py-2 text-xs font-semibold " +
            (feedback.tone === "ok"
              ? "bg-success-100 text-success-700"
              : "bg-danger-100 text-danger-700")
          }
        >
          {feedback.text}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {!terminal && ride.chauffeurId && (
          <button
            type="button"
            disabled={pending}
            onClick={() => openModal("complete")}
            className="bg-success-600 hover:bg-success-700 inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            <Check className="size-3.5" />
            Clôturer comme terminée
          </button>
        )}
        {!terminal && (
          <button
            type="button"
            disabled={pending}
            onClick={() => openModal("cancel")}
            className="border-danger-200 text-danger-700 hover:bg-danger-50 inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-xs font-bold disabled:opacity-50"
          >
            <Ban className="size-3.5" />
            Annuler{ride.escrowDa > 0 ? " + rembourser le séquestre" : ""}
          </button>
        )}
        {ride.refundRemainingDa > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => openModal("refund")}
            className="border-border hover:bg-surface-2 inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-xs font-bold disabled:opacity-50"
          >
            <Wallet className="size-3.5" />
            Rembourser le client ({formatDA(ride.refundRemainingDa)} max)
          </button>
        )}
        {ride.chauffeurId && (
          <button
            type="button"
            disabled={pending}
            onClick={() => openModal("compensate")}
            className="border-border hover:bg-surface-2 inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-xs font-bold disabled:opacity-50"
          >
            <HandCoins className="size-3.5" />
            Indemniser le chauffeur
          </button>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface w-full max-w-sm rounded-[18px] p-5 shadow-2xl">
            <h3 className="text-base font-black">
              {
                {
                  cancel: "Annuler la course",
                  complete: "Clôturer comme terminée",
                  refund: "Rembourser le client",
                  compensate: `Indemniser ${ride.chauffeurName ?? "le chauffeur"}`,
                }[modal]
              }
            </h3>
            <p className="text-muted mt-1 text-xs">
              {
                {
                  cancel:
                    "Le séquestre éventuel (carte / Coligo Pay) est recrédité au client immédiatement.",
                  complete:
                    "Le chauffeur est payé comme une fin de course normale (commission et cashback appliqués).",
                  refund:
                    "Crédité sur le Coligo Pay du client — anti-double-remboursement garanti côté base.",
                  compensate:
                    "Crédit motivé du portefeuille opérateur du chauffeur (grand livre immuable).",
                }[modal]
              }
            </p>

            {(modal === "refund" || modal === "compensate") && (
              <input
                inputMode="numeric"
                value={amount}
                onChange={(e) =>
                  setAmount(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder={
                  modal === "refund"
                    ? `Montant (DA, max ${ride.refundRemainingDa})`
                    : "Montant (DA, max 20 000)"
                }
                className="border-border bg-surface-2 mt-3 w-full rounded-[12px] border px-3 py-2.5 text-lg font-bold tabular-nums outline-none"
              />
            )}

            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 300))}
              rows={2}
              placeholder="Motif (obligatoire, tracé dans l'audit)"
              className="border-border bg-surface-2 mt-3 w-full resize-none rounded-[12px] border px-3 py-2.5 text-[13px] outline-none"
            />

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setModal(null)}
                disabled={pending}
                className="border-border text-muted flex-1 rounded-[12px] border py-2.5 text-sm font-bold"
              >
                Retour
              </button>
              <button
                type="button"
                disabled={
                  pending ||
                  reason.trim() === "" ||
                  ((modal === "refund" || modal === "compensate") &&
                    (amount === "" || Number(amount) < 1))
                }
                onClick={() => {
                  const motif = reason.trim();
                  const amt = Number(amount);
                  if (modal === "cancel")
                    run(
                      () => adminCancelRide({ rideId: ride.id, reason: motif }),
                      "Course annulée — remboursement et notifications envoyés."
                    );
                  else if (modal === "complete")
                    run(
                      () =>
                        adminCompleteRide({ rideId: ride.id, reason: motif }),
                      "Course clôturée — chauffeur payé et notifié."
                    );
                  else if (modal === "refund")
                    run(
                      () =>
                        adminRefundRideCustomer({
                          rideId: ride.id,
                          amountDa: amt,
                          reason: motif,
                        }),
                      "Client remboursé sur son Coligo Pay — notification envoyée."
                    );
                  else
                    run(
                      () =>
                        adminCompensateChauffeur({
                          rideId: ride.id,
                          amountDa: amt,
                          reason: motif,
                        }),
                      "Indemnité créditée sur le portefeuille du chauffeur."
                    );
                }}
                className={
                  "inline-flex flex-1 items-center justify-center gap-1 rounded-[12px] py-2.5 text-sm font-bold text-white disabled:opacity-50 " +
                  (modal === "cancel"
                    ? "bg-danger-600 hover:bg-danger-700"
                    : modal === "complete"
                      ? "bg-success-600 hover:bg-success-700"
                      : "bg-primary-600 hover:bg-primary-700")
                }
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  {
                    cancel: "Confirmer l'annulation",
                    complete: "Confirmer la clôture",
                    refund: "Rembourser",
                    compensate: "Créditer",
                  }[modal]
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
