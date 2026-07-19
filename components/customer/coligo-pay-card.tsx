"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { formatDA, cn } from "@/lib/utils";
import { useInappPayment } from "@/lib/payments/use-inapp-payment";
import {
  PaymentResultOverlay,
  type PaymentResultState,
} from "@/components/payments/payment-result-overlay";
import { createTopup, isTopupPaid } from "@/app/(customer)/cashback/actions";

// =============================================================================
// ColigoPayCard — bouton « Recharger » + modale (montants prédéfinis + libre).
// =============================================================================
// La page parent (/coligo-pay) se charge de l'affichage du solde et du
// contexte. Ce composant n'a qu'une responsabilité : déclencher une recharge.
//
// Le plafond glissant est vérifié serveur. Côté client, on désactive le
// bouton si remaining30d est nul ou si > maxPerRecharge.
// =============================================================================

const PRESETS = [500, 1000, 2000, 5000];

export function ColigoPayCard({
  remaining30d,
  maxPerRecharge,
}: {
  /** Solde actuel — non utilisé pour l'affichage (laissé pour API). */
  balanceDa?: number;
  remaining30d: number;
  maxPerRecharge: number;
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("wallet");
  const disabled = remaining30d <= 0;
  return (
    <div className="mt-4">
      <Button
        type="button"
        size="lg"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="w-full sm:w-auto"
      >
        {t("rechargeColigoPay")}
      </Button>
      {disabled && (
        <p className="text-warning-700 mt-2 text-xs">
          {t("monthlyCapReached")}
        </p>
      )}
      {open && (
        <TopupModal
          onClose={() => setOpen(false)}
          remaining30d={remaining30d}
          maxPerRecharge={maxPerRecharge}
        />
      )}
    </div>
  );
}

export function TopupModal({
  onClose,
  remaining30d,
  maxPerRecharge,
}: {
  onClose: () => void;
  remaining30d: number;
  maxPerRecharge: number;
}) {
  const [amount, setAmount] = useState<number>(1000);
  const [custom, setCustom] = useState<string>("");
  const [pending, start] = useTransition();
  const [note, setNote] = useActionNote();
  const t = useTranslations("wallet");
  const router = useRouter();
  const cap = Math.min(maxPerRecharge, remaining30d);
  const checkoutIdRef = useRef<string | null>(null);
  // Paiement DANS l'app + overlay de résultat natif (traitement → réussi /
  // échoué / annulé / expiré). Succès → on rafraîchit le portefeuille.
  const pay = useInappPayment({ onPaid: () => router.refresh() });

  function submit() {
    const value = custom ? Number(custom) : amount;
    if (!Number.isFinite(value) || value <= 0) {
      setNote({ ok: false, text: t("invalidAmount") });
      return;
    }
    start(async () => {
      setNote(null);
      await pay.start(
        async () => {
          const res = await createTopup(value);
          if (!res.ok) {
            setNote({ ok: false, text: res.error });
            return null;
          }
          checkoutIdRef.current = res.checkout_id;
          return res.checkout_url;
        },
        async () =>
          checkoutIdRef.current ? isTopupPaid(checkoutIdRef.current) : false
      );
    });
  }

  const resultText = (
    s: PaymentResultState
  ): { title: string; sub?: string } => {
    switch (s) {
      case "processing":
        return { title: t("payProcessing") };
      case "success":
        return { title: t("paySuccess"), sub: t("paySuccessSub") };
      case "failed":
        return { title: t("payFailed"), sub: t("payFailedSub") };
      case "cancelled":
        return { title: t("payCancelled"), sub: t("payCancelledSub") };
      case "expired":
        return { title: t("payExpired"), sub: t("payExpiredSub") };
    }
  };

  if (pay.state) {
    const rt = resultText(pay.state);
    const terminalBad =
      pay.state === "failed" ||
      pay.state === "cancelled" ||
      pay.state === "expired";
    return (
      <PaymentResultOverlay
        state={pay.state}
        title={rt.title}
        sub={rt.sub}
        primaryLabel={
          pay.state === "success" ? t("backToWallet") : t("payRetry")
        }
        onPrimary={
          pay.state === "success"
            ? () => {
                pay.reset();
                onClose();
              }
            : terminalBad
              ? () => {
                  pay.reset();
                  submit();
                }
              : undefined
        }
        secondaryLabel={terminalBad ? t("close") : undefined}
        onSecondary={
          terminalBad
            ? () => {
                pay.reset();
                onClose();
              }
            : undefined
        }
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface w-full max-w-md rounded-t-[20px] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-[20px] sm:pb-5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-foreground text-lg font-bold">
            {t("rechargeModalTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label={t("close")}
          >
            <X className="size-5" />
          </button>
        </header>

        <p className="text-muted mb-3 text-xs">
          {t("remainingCap30d")}{" "}
          <span className="text-foreground font-medium tabular-nums">
            {formatDA(remaining30d)}
          </span>
        </p>

        <div className="mb-3 grid grid-cols-2 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={p > cap}
              onClick={() => {
                setAmount(p);
                setCustom("");
              }}
              className={cn(
                "rounded-[12px] border px-3 py-3 text-sm font-semibold tabular-nums transition disabled:cursor-not-allowed disabled:opacity-50",
                amount === p && !custom
                  ? "border-primary-600 bg-primary-600 text-white"
                  : "border-border bg-surface hover:border-primary-300"
              )}
            >
              {formatDA(p)}
            </button>
          ))}
        </div>

        <label className="text-foreground text-xs font-semibold tracking-wider uppercase">
          {t("customAmount")}
        </label>
        <input
          type="number"
          inputMode="numeric"
          min={100}
          max={cap}
          step={100}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder={t("customAmountPlaceholder")}
          className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 mt-1.5 w-full rounded-[12px] border px-3 py-2 text-sm tabular-nums focus-visible:ring-2 focus-visible:outline-none"
        />

        <Button
          type="button"
          size="lg"
          className="mt-4 w-full"
          onClick={submit}
          disabled={pending || cap <= 0}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            t("payViaChargily", {
              amount: formatDA(custom ? Number(custom) || 0 : amount),
            })
          )}
        </Button>
        <ActionNote note={note} className="mt-2 text-center" />
        <p className="text-muted mt-3 text-center text-[11px]">
          {t("chargilyRedirectNote")}
        </p>
      </div>
    </div>
  );
}
