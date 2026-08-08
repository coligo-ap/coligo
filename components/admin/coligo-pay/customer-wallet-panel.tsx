"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MinusCircle, PlusCircle } from "lucide-react";
import { adminAdjustCustomerWallet } from "@/app/admin/coligo-pay/portefeuilles/actions";

// =============================================================================
// Ajustement MOTIVÉ du portefeuille client (crédit ou débit, Coligo Pay ou
// cashback) — admin_customer_credit (0346) : append-only, jamais de solde
// négatif, audité, client notifié. Messages inline.
// =============================================================================

export function CustomerWalletPanel({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"credit" | "debit" | null>(null);
  const [source, setSource] = useState<"topup" | "cashback">("topup");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const submit = () => {
    const amt = Number(amount) * (mode === "debit" ? -1 : 1);
    start(async () => {
      const res = await adminAdjustCustomerWallet({
        customerId,
        amountDa: amt,
        source,
        reason: reason.trim(),
      });
      if (res.error) setFeedback({ tone: "error", text: res.error });
      else {
        setFeedback({
          tone: "ok",
          text:
            mode === "credit"
              ? "Crédit effectué — client notifié."
              : "Débit effectué — client notifié.",
        });
        setMode(null);
        setAmount("");
        setReason("");
      }
      router.refresh();
    });
  };

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

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setFeedback(null);
            setMode("credit");
          }}
          className="bg-success-600 hover:bg-success-700 rounded-control inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
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
          className="border-danger-200 text-danger-700 hover:bg-danger-50 rounded-control inline-flex items-center gap-1.5 border px-3 py-2 text-xs font-bold disabled:opacity-50"
        >
          <MinusCircle className="size-3.5" />
          Débiter
        </button>
      </div>

      {mode && (
        <div className="border-border bg-surface-2 mt-3 space-y-2 rounded-md border p-3">
          <div className="flex gap-2">
            {(
              [
                ["topup", "Coligo Pay"],
                ["cashback", "Cashback"],
              ] as const
            ).map(([s, label]) => (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                className={
                  "rounded-control flex-1 border px-2 py-2 text-xs font-semibold " +
                  (source === s
                    ? "border-primary-400 bg-primary-50 text-primary-700"
                    : "border-border bg-surface text-muted")
                }
              >
                {label}
              </button>
            ))}
          </div>
          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) =>
              setAmount(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="Montant (DA, max 100 000)"
            className="border-border bg-surface w-full rounded-md border px-3 py-2.5 text-lg font-bold tabular-nums outline-none"
          />
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 300))}
            rows={2}
            placeholder="Motif (obligatoire, tracé dans l'audit)"
            className="border-border bg-surface text-body-sm w-full resize-none rounded-md border px-3 py-2.5 outline-none"
          />
          {mode === "debit" && (
            <p className="text-warning-800 text-caption font-semibold">
              Un débit ne peut jamais rendre le solde négatif (refusé sinon).
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode(null)}
              disabled={pending}
              className="border-border text-muted flex-1 rounded-md border py-2.5 text-sm font-bold"
            >
              Retour
            </button>
            <button
              type="button"
              disabled={
                pending || reason.trim() === "" || !amount || Number(amount) < 1
              }
              onClick={submit}
              className={
                "flex-1 rounded-md py-2.5 text-sm font-bold text-white disabled:opacity-50 " +
                (mode === "credit"
                  ? "bg-success-600 hover:bg-success-700"
                  : "bg-danger-600 hover:bg-danger-700")
              }
            >
              {pending ? (
                <Loader2 className="mx-auto size-4 animate-spin" />
              ) : mode === "credit" ? (
                "Confirmer le crédit"
              ) : (
                "Confirmer le débit"
              )}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
