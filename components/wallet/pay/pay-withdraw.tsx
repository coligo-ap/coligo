"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock3, Landmark, Loader2, Smartphone, Wallet } from "lucide-react";
import {
  getMyWithdrawals,
  requestOperatorWithdrawal,
  type MyWithdrawal,
} from "@/app/wallet/withdraw-actions";
import {
  PartnerBackHeader,
  PartnerBadge,
  PartnerInlineError,
  PartnerSegmented,
  SORA,
} from "@/components/shared/partner-ui";
import {
  PayCard,
  PayPrimaryButton,
  PayScreen,
  PaySkeleton,
  fmtDay,
  groupNum,
  invalidatePayCache,
  payHref,
  usePayLang,
  usePayWallet,
  type PayBase,
} from "./pay-core";

type WMethod = "ccp" | "baridimob";
type Step = "form" | "review" | "sent";

/**
 * RETIRER MON ARGENT (chauffeur / livreur) — parcours guidé : méthode →
 * destination → montant → récap → demande. Le débit réel n'a lieu qu'au
 * paiement par l'équipe Coligo (garde de solde serveur, mig 0384). Une seule
 * demande en cours à la fois : l'écran devient un SUIVI tant qu'elle est
 * en traitement.
 */
export function PayWithdraw({ base }: { base: PayBase }) {
  const { lang, t, dir } = usePayLang();
  const { state, loading } = usePayWallet();

  const [withdrawals, setWithdrawals] = useState<MyWithdrawal[] | null>(null);
  const [step, setStep] = useState<Step>("form");
  const [method, setMethod] = useState<WMethod>("ccp");
  const [destination, setDestination] = useState("");
  const [destName, setDestName] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refreshWithdrawals = useCallback(async () => {
    try {
      setWithdrawals(await getMyWithdrawals());
    } catch {
      setWithdrawals([]);
    }
  }, []);
  useEffect(() => {
    void refreshWithdrawals();
  }, [refreshWithdrawals]);

  const available = Math.max(0, state?.effectiveBalanceDa ?? 0);
  const amt = Number(amount);
  const amtValid = Number.isFinite(amt) && amt >= 100 && amt <= available;
  const destValid =
    destination.trim().length >= 6 && destination.trim().length <= 40;

  const submit = async () => {
    if (busy || !amtValid || !destValid) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await requestOperatorWithdrawal({
        method,
        amountDa: amt,
        destination,
        destinationName: destName,
      });
      if (!res.ok) {
        setErr(res.error ?? t.loadFail);
        setStep("form");
        return;
      }
      invalidatePayCache();
      await refreshWithdrawals();
      setStep("sent");
    } finally {
      setBusy(false);
    }
  };

  if ((loading && !state) || withdrawals === null) {
    return (
      <PayScreen dir={dir}>
        <PartnerBackHeader title={t.withdrawTitle} href={payHref(base)} />
        <PaySkeleton hero={false} />
      </PayScreen>
    );
  }

  const pending = withdrawals.find((w) => w.status === "pending") ?? null;
  const past = withdrawals.filter((w) => w.status !== "pending").slice(0, 5);
  const methodLabel = (m: string) =>
    m === "baridimob"
      ? "BaridiMob"
      : lang === "ar"
        ? "تحويل CCP"
        : "Virement CCP";

  /* ── SUIVI : une demande est en cours (ou vient d'être envoyée) ── */
  if (pending || step === "sent") {
    const w = pending;
    return (
      <PayScreen dir={dir}>
        <PartnerBackHeader title={t.withdrawTitle} href={payHref(base)} />
        <PayCard className="px-4 py-7 text-center">
          <span
            className="mx-auto grid size-12 place-items-center rounded-full"
            style={{ background: "var(--d-accent)", color: "var(--d-violet)" }}
          >
            <Clock3 className="size-5" />
          </span>
          <p
            className="mt-3 text-[16px] font-extrabold text-[var(--d-ink)]"
            style={{ fontFamily: SORA }}
          >
            {t.wPendingTitle}
          </p>
          <p className="mt-1 text-[12px] font-medium text-[var(--d-muted)]">
            {t.wPendingSub}
          </p>
          {w && (
            <div className="mt-4 border-t border-dashed border-[var(--d-line)] text-[12.5px]">
              <Row k={t.wAmountLabel} v={`${groupNum(w.amountDa)} DA`} strong />
              <Row k={t.opType} v={methodLabel(w.method)} />
              <Row k={t.wDestination} v={w.destination} />
              <Row k={t.opDate} v={fmtDay(w.createdAt, lang)} />
            </div>
          )}
        </PayCard>
        {past.length > 0 && (
          <PastList past={past} lang={lang} t={t} methodLabel={methodLabel} />
        )}
      </PayScreen>
    );
  }

  /* ── RÉCAP avant envoi ── */
  if (step === "review") {
    return (
      <PayScreen dir={dir}>
        {/* Pas de bouton retour navigateur ici : « Modifier » ramène au
            formulaire sans quitter la page (état local). */}
        <h1
          className="mb-4 text-[19px] font-extrabold tracking-[-0.4px] text-[var(--d-ink)]"
          style={{ fontFamily: SORA }}
        >
          {t.wReview}
        </h1>
        <PayCard className="px-4 py-4">
          <Row k={t.wAmountLabel} v={`${groupNum(amt)} DA`} strong />
          <Row k={t.opType} v={methodLabel(method)} />
          <Row k={t.wDestination} v={destination.trim()} />
          {destName.trim() && <Row k={t.wDestName} v={destName.trim()} />}
          <p className="mt-3 text-[11.5px] leading-snug font-medium text-[var(--d-muted)]">
            {t.wReviewNote}
          </p>
          <div className="mt-3 space-y-2">
            <PayPrimaryButton onClick={() => void submit()} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t.wConfirm}
            </PayPrimaryButton>
            <button
              type="button"
              onClick={() => setStep("form")}
              className="flex w-full items-center justify-center rounded-[14px] border border-[var(--d-line)] py-3 text-[13px] font-bold text-[var(--d-ink)]"
            >
              {t.wEdit}
            </button>
          </div>
          {err && (
            <div className="mt-2">
              <PartnerInlineError>{err}</PartnerInlineError>
            </div>
          )}
        </PayCard>
      </PayScreen>
    );
  }

  /* ── FORMULAIRE ── */
  return (
    <PayScreen dir={dir}>
      <PartnerBackHeader title={t.withdrawTitle} href={payHref(base)} />

      {/* Solde disponible — le plafond du retrait */}
      <div
        className="mb-3 flex items-center gap-3 rounded-[16px] p-3.5"
        style={{ background: "var(--d-accent)" }}
      >
        <span
          className="grid size-9 place-items-center rounded-[12px] bg-[var(--d-surface)]"
          style={{ color: "var(--d-violet)" }}
        >
          <Wallet className="size-4" />
        </span>
        <span className="flex-1 text-[12.5px] font-bold text-[var(--d-ink)]">
          {t.availableBalance}
        </span>
        <span
          className="text-[15px] font-extrabold text-[var(--d-ink)]"
          style={{ fontFamily: SORA }}
        >
          {groupNum(available)} DA
        </span>
      </div>

      <PayCard className="p-3.5">
        <p className="mb-2 text-[12.5px] font-bold text-[var(--d-muted)]">
          {t.wMethodLabel}
        </p>
        <PartnerSegmented<WMethod>
          options={[
            { key: "ccp", label: lang === "ar" ? "تحويل CCP" : "Virement CCP" },
            { key: "baridimob", label: "BaridiMob" },
          ]}
          value={method}
          onChange={setMethod}
        />
        <div className="mt-3 flex items-center gap-2 text-[12px] font-semibold text-[var(--d-muted)]">
          {method === "ccp" ? (
            <Landmark className="size-3.5" />
          ) : (
            <Smartphone className="size-3.5" />
          )}
          {method === "ccp" ? t.wDestCcp : t.wDestRip}
        </div>
        <input
          className="mt-1.5 w-full rounded-[12px] border border-[var(--d-line)] bg-[var(--d-field)] px-3.5 py-3 text-[13.5px] font-bold text-[var(--d-ink)] outline-none placeholder:font-medium placeholder:text-[var(--d-muted)]"
          value={destination}
          onChange={(e) => setDestination(e.target.value.slice(0, 40))}
          inputMode="numeric"
          placeholder={method === "ccp" ? "3333 3333 33 · clé 33" : "00799999…"}
        />
        <input
          className="mt-2 w-full rounded-[12px] border border-[var(--d-line)] bg-[var(--d-field)] px-3.5 py-3 text-[13.5px] font-bold text-[var(--d-ink)] outline-none placeholder:font-medium placeholder:text-[var(--d-muted)]"
          value={destName}
          onChange={(e) => setDestName(e.target.value)}
          placeholder={t.wDestName}
        />
        <p className="mt-3 mb-1.5 text-[12.5px] font-bold text-[var(--d-muted)]">
          {t.wAmountLabel}
        </p>
        <input
          className="w-full rounded-[12px] border border-[var(--d-line)] bg-[var(--d-field)] px-3.5 py-3 text-[13.5px] font-bold text-[var(--d-ink)] outline-none placeholder:font-medium placeholder:text-[var(--d-muted)]"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
          inputMode="numeric"
          placeholder={`${t.wAmountMax} ${groupNum(available)} DA`}
        />
        <div className="mt-3">
          <PayPrimaryButton
            onClick={() => {
              setErr(null);
              setStep("review");
            }}
            disabled={!amtValid || !destValid}
          >
            {t.continue}
          </PayPrimaryButton>
        </div>
        {err && (
          <div className="mt-2">
            <PartnerInlineError>{err}</PartnerInlineError>
          </div>
        )}
      </PayCard>

      {past.length > 0 && (
        <PastList past={past} lang={lang} t={t} methodLabel={methodLabel} />
      )}
    </PayScreen>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--d-line)] py-2.5 last:border-b-0">
      <span className="text-[12px] font-semibold text-[var(--d-muted)]">
        {k}
      </span>
      <span
        className="min-w-0 truncate text-[12.5px] font-bold text-[var(--d-ink)]"
        style={strong ? { fontFamily: SORA, fontSize: 14 } : undefined}
      >
        {v}
      </span>
    </div>
  );
}

function PastList({
  past,
  lang,
  t,
  methodLabel,
}: {
  past: MyWithdrawal[];
  lang: "fr" | "ar";
  t: { wPast: string; wPaid: string; wRejected: string };
  methodLabel: (m: string) => string;
}) {
  return (
    <PayCard className="mt-3">
      <p className="px-3.5 pt-3 pb-1 text-[12px] font-bold text-[var(--d-muted)]">
        {t.wPast}
      </p>
      {past.map((w) => (
        <div
          key={w.id}
          className="flex items-center gap-3 border-b border-[var(--d-line)] px-3.5 py-3 last:border-b-0"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-bold text-[var(--d-ink)]">
              {groupNum(w.amountDa)} DA · {methodLabel(w.method)}
            </span>
            <span className="block text-[11px] font-medium text-[var(--d-muted)]">
              {fmtDay(w.createdAt, lang)}
              {w.status === "rejected" && w.reviewNote
                ? ` · ${w.reviewNote}`
                : ""}
            </span>
          </span>
          <PartnerBadge tone={w.status === "paid" ? "ok" : "ko"}>
            {w.status === "paid" ? t.wPaid : t.wRejected}
          </PartnerBadge>
        </div>
      ))}
    </PayCard>
  );
}
