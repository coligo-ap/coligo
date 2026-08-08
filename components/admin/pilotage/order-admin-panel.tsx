"use client";

import { useState, useTransition } from "react";
import {
  Ban,
  Check,
  HandCoins,
  Loader2,
  PackageCheck,
  PackageX,
  RefreshCw,
  Undo2,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";
import { formatDA } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import type { AdminCandidateDriver } from "@/lib/data/admin-orders";
import {
  adminCancelOrder,
  adminCompensateDriver,
  adminDecideNoCompensation,
  adminMarkDeliveryFailed,
  adminReassignOrderDriver,
  adminRequeueCancelledDelivery,
  adminRefundCustomer,
  adminRefundMerchant,
  adminValidateDelivery,
  confirmOnlineNoShow,
} from "@/app/admin/actions";

// =============================================================================
// Panneau d'actions de la fiche commande (super-admin). Toutes les mutations
// passent par les server actions (RPC gardées par domaine + audit + notifs
// temps réel vers client / livreur / commerçant). Résultats affichés INLINE
// dans le panneau (règle produit : pas de toast pour une action contextuelle).
// Chaque action destructive exige un MOTIF (traçabilité).
// =============================================================================

type PanelOrder = {
  id: string;
  orderNumber: string | null;
  status: string;
  isDelivery: boolean;
  deliveryMode: string | null;
  paymentMethod: string;
  paymentStatus: string;
  pickedUp: boolean;
  driverId: string | null;
  driverName: string | null;
  refundRemainingDa: number;
  alreadyCompensated: boolean;
  /** Livreurs apparus dans le grand livre (indemnisables même après retrait). */
  ledgerDrivers: { id: string; full_name: string }[];
};

type ModalKind =
  | "cancel"
  | "failed"
  | "reassign"
  | "compensate"
  | "no-compensation"
  | "refund-customer"
  | "refund-merchant";

type Feedback = { tone: "ok" | "error"; text: string } | null;

export function OrderAdminPanel({
  order,
  candidates,
}: {
  order: PanelOrder;
  candidates: AdminCandidateDriver[];
}) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  // Champs des mini-formulaires.
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [targetDriver, setTargetDriver] = useState("");

  const terminal = order.status === "completed" || order.status === "cancelled";
  const canValidate = order.isDelivery && !terminal;
  const canNoShow =
    order.isDelivery &&
    !terminal &&
    order.paymentMethod === "online" &&
    order.paymentStatus === "paid" &&
    !!order.driverId &&
    order.pickedUp;
  const canReassign = order.isDelivery && !terminal;
  // Remise au canal : livraison ANNULÉE non livrée (le serveur re-vérifie
  // livrée/remboursée — ici seulement le gate visuel).
  const canRequeue = order.isDelivery && order.status === "cancelled";
  const canRefundCustomer = order.refundRemainingDa > 0;

  // Livreurs proposables pour l'indemnisation : porteur actuel + ceux du ledger.
  const compensables = [
    ...new Map(
      [
        ...(order.driverId && order.driverName
          ? [{ id: order.driverId, full_name: order.driverName }]
          : []),
        ...order.ledgerDrivers,
      ].map((d) => [d.id, d])
    ).values(),
  ];
  const [compensateDriverId, setCompensateDriverId] = useState(
    compensables[0]?.id ?? ""
  );

  const openModal = (kind: ModalKind) => {
    setFeedback(null);
    setReason("");
    setAmount("");
    setTargetDriver("");
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
    });

  const btn = (variant: "primary" | "danger" | "warning" | "neutral") =>
    "inline-flex items-center gap-1.5 rounded-control px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50 " +
    {
      primary: "bg-success-600 hover:bg-success-700 text-white",
      danger: "border-danger-200 text-danger-700 hover:bg-danger-50 border",
      warning: "border-warning-200 text-warning-800 hover:bg-warning-50 border",
      neutral: "border-border hover:bg-surface-2 border",
    }[variant];

  return (
    <section className="border-border bg-surface rounded-card-lg mt-3 border p-4">
      <h2 className="text-muted text-xs font-bold uppercase">Gestion</h2>

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

      {/* ---- Cycle de vie ---- */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {canValidate && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () => adminValidateDelivery(order.id),
                "Livraison validée — client notifié."
              )
            }
            className={btn("primary")}
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            Valider la livraison
          </button>
        )}
        {canNoShow && (
          <button
            type="button"
            disabled={pending}
            onClick={async () => {
              if (
                !(await confirm({
                  title: "Confirmer un no-show EN LIGNE ?",
                  message:
                    "La commande sera traitée COMME LIVRÉE : livreur et commerçant payés, cashback conservé. Action tracée.",
                  confirmLabel: "Confirmer le no-show",
                  danger: true,
                }))
              )
                return;
              run(
                () => confirmOnlineNoShow(order.id),
                "No-show en ligne confirmé — payé comme livré."
              );
            }}
            className={btn("warning")}
          >
            <PackageCheck className="size-3.5" />
            Confirmer no-show en ligne
          </button>
        )}
        {order.isDelivery && !terminal && (
          <button
            type="button"
            disabled={pending}
            onClick={() => openModal("failed")}
            className={btn("warning")}
          >
            <PackageX className="size-3.5" />
            Marquer en échec
          </button>
        )}
        {!terminal && (
          <button
            type="button"
            disabled={pending}
            onClick={() => openModal("cancel")}
            className={btn("danger")}
          >
            <Ban className="size-3.5" />
            Annuler
          </button>
        )}
        {canReassign && (
          <button
            type="button"
            disabled={pending}
            onClick={() => openModal("reassign")}
            className={btn("neutral")}
          >
            <RefreshCw className="size-3.5" />
            {order.driverId
              ? "Retirer / réattribuer le livreur"
              : "Attribuer un livreur"}
          </button>
        )}
        {/* Livraison ANNULÉE → remise au canal de proposition (façon Uber).
            La RPC refuse serveur-side si livrée ou déjà remboursée. */}
        {canRequeue && (
          <button
            type="button"
            disabled={pending}
            onClick={async () => {
              if (
                !(await confirm({
                  title: "Remettre cette livraison au canal ?",
                  message:
                    "La commande annulée repasse « prête » : l'attribution et les refus sont purgés, et elle est re-proposée immédiatement au réseau de livreurs.",
                  confirmLabel: "Remettre au canal",
                }))
              )
                return;
              run(
                () => adminRequeueCancelledDelivery({ orderId: order.id }),
                "Commande remise au canal — réseau re-notifié."
              );
            }}
            className={btn("neutral")}
          >
            <RefreshCw className="size-3.5" />
            Remettre au canal (annulée)
          </button>
        )}
      </div>

      {/* ---- Argent ---- */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {compensables.length > 0 && (
          <>
            <button
              type="button"
              disabled={pending || order.alreadyCompensated}
              onClick={() => openModal("compensate")}
              className={btn("neutral")}
              title={
                order.alreadyCompensated
                  ? "Une indemnité a déjà été versée sur cette commande."
                  : undefined
              }
            >
              <HandCoins className="size-3.5" />
              {order.alreadyCompensated
                ? "Livreur déjà indemnisé"
                : "Indemniser le livreur"}
            </button>
            {!order.alreadyCompensated && (
              <button
                type="button"
                disabled={pending}
                onClick={() => openModal("no-compensation")}
                className={btn("neutral")}
              >
                <Undo2 className="size-3.5" />
                Ne pas indemniser (tracer)
              </button>
            )}
          </>
        )}
        {canRefundCustomer && (
          <button
            type="button"
            disabled={pending}
            onClick={() => openModal("refund-customer")}
            className={btn("neutral")}
          >
            <Wallet className="size-3.5" />
            Rembourser le client ({formatDA(order.refundRemainingDa)} max)
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => openModal("refund-merchant")}
          className={btn("neutral")}
        >
          <Wallet className="size-3.5" />
          Rembourser le commerçant
        </button>
      </div>

      {/* ---- Mini-formulaires (modale) ---- */}
      {modal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface rounded-sheet-lg w-full max-w-sm p-5 shadow-2xl">
            <h3 className="text-base font-black">
              {
                {
                  cancel: "Annuler la commande",
                  failed: "Marquer la livraison en échec",
                  reassign: "Retirer / réattribuer",
                  compensate: "Indemniser un livreur",
                  "no-compensation": "Ne pas indemniser",
                  "refund-customer": "Rembourser le client",
                  "refund-merchant": "Rembourser le commerçant",
                }[modal]
              }
            </h3>
            <p className="text-muted mt-1 text-xs">
              #{order.orderNumber ?? order.id.slice(0, 6).toUpperCase()}
            </p>

            {modal === "reassign" && (
              <div className="mt-3 space-y-2">
                {order.driverName && (
                  <p className="text-muted text-xs">
                    Porteur actuel : <strong>{order.driverName}</strong>
                    {order.pickedUp
                      ? " (a déclaré la récupération — la remise au réseau la remet à zéro)"
                      : ""}
                  </p>
                )}
                {order.deliveryMode === "express" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          adminReassignOrderDriver({
                            orderId: order.id,
                            mode: "pool",
                            reason: reason.trim() || null,
                          }),
                        "Commande remise au réseau — livreurs proches notifiés."
                      )
                    }
                    className="border-border hover:bg-surface-2 flex w-full items-center gap-2 rounded-md border px-3 py-2.5 text-sm font-bold"
                  >
                    <Users className="size-4" />
                    Remettre au réseau (priorité réseau)
                  </button>
                )}
                <div className="flex gap-2">
                  <select
                    value={targetDriver}
                    onChange={(e) => setTargetDriver(e.target.value)}
                    className="border-border bg-surface-2 rounded-control h-10 min-w-0 flex-1 border px-2 text-sm outline-none"
                  >
                    <option value="">Attribuer à un livreur…</option>
                    {candidates
                      .filter((c) => c.id !== order.driverId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.full_name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    disabled={pending || !targetDriver}
                    onClick={() =>
                      run(
                        () =>
                          adminReassignOrderDriver({
                            orderId: order.id,
                            mode: "driver",
                            targetDriverId: targetDriver,
                            reason: reason.trim() || null,
                          }),
                        "Commande réattribuée — nouveau livreur notifié."
                      )
                    }
                    className="bg-primary-600 hover:bg-primary-700 rounded-control inline-flex items-center gap-1 px-3 text-sm font-bold text-white disabled:opacity-50"
                  >
                    <UserCheck className="size-4" />
                    OK
                  </button>
                </div>
              </div>
            )}

            {modal === "compensate" && (
              <div className="mt-3 space-y-2">
                <select
                  value={compensateDriverId}
                  onChange={(e) => setCompensateDriverId(e.target.value)}
                  className="border-border bg-surface-2 rounded-control h-10 w-full border px-2 text-sm outline-none"
                >
                  {compensables.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name}
                    </option>
                  ))}
                </select>
                <input
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) =>
                    setAmount(e.target.value.replace(/\D/g, "").slice(0, 5))
                  }
                  placeholder="Montant (DA, max 20 000)"
                  className="border-border bg-surface-2 w-full rounded-md border px-3 py-2.5 text-lg font-bold tabular-nums outline-none"
                />
                <p className="text-subtle text-caption">
                  L&apos;indemnité apparaîtra « à recevoir » sur le prochain
                  relevé du livreur. Une seule indemnité par commande.
                </p>
              </div>
            )}

            {modal === "refund-customer" && (
              <div className="mt-3 space-y-2">
                <input
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) =>
                    setAmount(e.target.value.replace(/\D/g, "").slice(0, 7))
                  }
                  placeholder={`Montant (DA, max ${order.refundRemainingDa})`}
                  className="border-border bg-surface-2 w-full rounded-md border px-3 py-2.5 text-lg font-bold tabular-nums outline-none"
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAmount(String(order.refundRemainingDa))}
                    className="border-border text-muted text-caption rounded-full border px-2.5 py-1 font-bold"
                  >
                    Total ({formatDA(order.refundRemainingDa)})
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setAmount(String(Math.floor(order.refundRemainingDa / 2)))
                    }
                    className="border-border text-muted text-caption rounded-full border px-2.5 py-1 font-bold"
                  >
                    50 %
                  </button>
                </div>
                <p className="text-subtle text-caption">
                  Crédité sur le Coligo Pay du client (notification envoyée).
                  Anti-double-remboursement garanti côté base.
                </p>
              </div>
            )}

            {modal === "refund-merchant" && (
              <input
                inputMode="numeric"
                value={amount}
                onChange={(e) =>
                  setAmount(e.target.value.replace(/\D/g, "").slice(0, 7))
                }
                placeholder="Montant (DA)"
                className="border-border bg-surface-2 mt-3 w-full rounded-md border px-3 py-2.5 text-lg font-bold tabular-nums outline-none"
              />
            )}

            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 300))}
              rows={2}
              placeholder={
                modal === "reassign"
                  ? "Motif (optionnel, tracé dans l'audit)"
                  : "Motif (obligatoire, tracé dans l'audit)"
              }
              className="border-border bg-surface-2 text-body-sm mt-3 w-full resize-none rounded-md border px-3 py-2.5 outline-none"
            />

            {modal !== "reassign" && (
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
                  disabled={
                    pending ||
                    reason.trim() === "" ||
                    ((modal === "compensate" ||
                      modal === "refund-customer" ||
                      modal === "refund-merchant") &&
                      (amount === "" || Number(amount) < 1))
                  }
                  onClick={() => {
                    const amt = Number(amount);
                    const motif = reason.trim();
                    if (modal === "cancel")
                      run(
                        () => adminCancelOrder(order.id, motif),
                        "Commande annulée — remboursements et notifications déclenchés."
                      );
                    else if (modal === "failed")
                      run(
                        () => adminMarkDeliveryFailed(order.id, motif),
                        "Livraison marquée en échec — commande annulée et remboursée."
                      );
                    else if (modal === "compensate")
                      run(
                        () =>
                          adminCompensateDriver({
                            orderId: order.id,
                            driverId: compensateDriverId,
                            amountDa: amt,
                            reason: motif,
                          }),
                        "Indemnité créditée — livreur notifié."
                      );
                    else if (modal === "no-compensation")
                      run(
                        () =>
                          adminDecideNoCompensation({
                            orderId: order.id,
                            driverId: compensables[0]?.id ?? null,
                            reason: motif,
                          }),
                        "Décision tracée : pas d'indemnisation."
                      );
                    else if (modal === "refund-customer")
                      run(
                        () =>
                          adminRefundCustomer({
                            orderId: order.id,
                            amountDa: amt,
                            reason: motif,
                          }),
                        "Client remboursé sur son Coligo Pay — notification envoyée."
                      );
                    else if (modal === "refund-merchant")
                      run(
                        () => adminRefundMerchant(order.id, amt, motif),
                        "Commerçant remboursé."
                      );
                  }}
                  className={
                    "inline-flex flex-1 items-center justify-center gap-1 rounded-md py-2.5 text-sm font-bold text-white disabled:opacity-50 " +
                    (modal === "cancel" || modal === "failed"
                      ? "bg-danger-600 hover:bg-danger-700"
                      : "bg-primary-600 hover:bg-primary-700")
                  }
                >
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    {
                      cancel: "Confirmer l'annulation",
                      failed: "Confirmer l'échec",
                      compensate: "Créditer l'indemnité",
                      "no-compensation": "Tracer la décision",
                      "refund-customer": "Rembourser",
                      "refund-merchant": "Créditer",
                      reassign: "",
                    }[modal]
                  )}
                </button>
              </div>
            )}

            {modal === "reassign" && (
              <button
                type="button"
                onClick={() => setModal(null)}
                disabled={pending}
                className="text-muted mt-3 w-full text-center text-xs font-semibold"
              >
                Fermer
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
