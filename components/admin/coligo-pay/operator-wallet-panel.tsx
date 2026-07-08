"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  Loader2,
  MinusCircle,
  PauseCircle,
  PlayCircle,
  PlusCircle,
} from "lucide-react";
import { creditWallet, setWalletStatus } from "@/app/admin/recharges/actions";
import { recordPartnerPayout } from "@/app/admin/versements/actions";

// =============================================================================
// Gestion d'un portefeuille OPÉRATEUR (livreur / chauffeur / commerçant /
// agent) — réutilise les actions existantes : creditWallet (crédit/débit
// motivé via admin_operator_credit, grand livre immuable), setWalletStatus
// (gel/dégel), recordPartnerPayout (versement agent). Messages inline.
// =============================================================================

export function OperatorWalletPanel({
  walletId,
  status,
  isPartner,
}: {
  walletId: string;
  status: string;
  isPartner: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"credit" | "debit" | "payout" | null>(null);
  const [type, setType] = useState<"adjustment" | "bonus" | "topup_manual">(
    "adjustment"
  );
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const run = (
    fn: () => Promise<{ ok?: boolean; error?: string }>,
    okMsg: string
  ) =>
    start(async () => {
      const res = await fn();
      if (res.error) setFeedback({ tone: "error", text: res.error });
      else {
        setFeedback({ tone: "ok", text: okMsg });
        setMode(null);
        setAmount("");
        setReason("");
      }
      router.refresh();
    });

  const suspended = status !== "active";

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
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setFeedback(null);
            setMode("credit");
          }}
          className="bg-success-600 hover:bg-success-700 inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          <PlusCircle className="size-3.5" />
          Créditer
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setFeedback(null);
            setMode("debit");
          }}
          className="border-danger-200 text-danger-700 hover:bg-danger-50 inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-xs font-bold disabled:opacity-50"
        >
          <MinusCircle className="size-3.5" />
          Débiter
        </button>
        {isPartner && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setFeedback(null);
              setMode("payout");
            }}
            className="border-border hover:bg-surface-2 inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-xs font-bold disabled:opacity-50"
          >
            <Banknote className="size-3.5" />
            Enregistrer un versement
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                setWalletStatus(walletId, suspended ? "active" : "suspended"),
              suspended ? "Portefeuille réactivé." : "Portefeuille suspendu."
            )
          }
          className={
            "inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-xs font-bold disabled:opacity-50 " +
            (suspended
              ? "border-success-200 text-success-700 hover:bg-success-50"
              : "border-warning-200 text-warning-800 hover:bg-warning-50")
          }
        >
          {suspended ? (
            <PlayCircle className="size-3.5" />
          ) : (
            <PauseCircle className="size-3.5" />
          )}
          {suspended ? "Réactiver" : "Suspendre"}
        </button>
      </div>

      {mode && (
        <div className="border-border bg-surface-2 mt-3 space-y-2 rounded-[12px] border p-3">
          {mode !== "payout" && (
            <div className="flex gap-2">
              {(
                [
                  ["adjustment", "Ajustement"],
                  ["bonus", "Bonus"],
                  ["topup_manual", "Recharge manuelle"],
                ] as const
              ).map(([t, label]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={
                    "flex-1 rounded-[10px] border px-2 py-2 text-xs font-semibold " +
                    (type === t
                      ? "border-primary-400 bg-primary-50 text-primary-700"
                      : "border-border bg-surface text-muted")
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) =>
              setAmount(e.target.value.replace(/\D/g, "").slice(0, 7))
            }
            placeholder="Montant (DA)"
            className="border-border bg-surface w-full rounded-[12px] border px-3 py-2.5 text-lg font-bold tabular-nums outline-none"
          />
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 300))}
            rows={2}
            placeholder="Motif / note (obligatoire, tracé)"
            className="border-border bg-surface w-full resize-none rounded-[12px] border px-3 py-2.5 text-[13px] outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode(null)}
              disabled={pending}
              className="border-border text-muted flex-1 rounded-[12px] border py-2.5 text-sm font-bold"
            >
              Retour
            </button>
            <button
              type="button"
              disabled={
                pending || reason.trim() === "" || !amount || Number(amount) < 1
              }
              onClick={() => {
                const amt = Number(amount);
                if (mode === "payout")
                  run(
                    () =>
                      recordPartnerPayout({
                        walletId,
                        amountDa: amt,
                        note: reason.trim(),
                      }),
                    "Versement enregistré (débit du portefeuille)."
                  );
                else
                  run(
                    () =>
                      creditWallet({
                        walletId,
                        amountDa: mode === "debit" ? -amt : amt,
                        type,
                        note: reason.trim(),
                      }),
                    mode === "debit" ? "Débit effectué." : "Crédit effectué."
                  );
              }}
              className={
                "flex-1 rounded-[12px] py-2.5 text-sm font-bold text-white disabled:opacity-50 " +
                (mode === "debit" || mode === "payout"
                  ? "bg-danger-600 hover:bg-danger-700"
                  : "bg-success-600 hover:bg-success-700")
              }
            >
              {pending ? (
                <Loader2 className="mx-auto size-4 animate-spin" />
              ) : mode === "payout" ? (
                "Confirmer le versement"
              ) : mode === "debit" ? (
                "Confirmer le débit"
              ) : (
                "Confirmer le crédit"
              )}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
