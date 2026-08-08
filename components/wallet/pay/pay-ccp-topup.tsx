"use client";

import { useRef, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Copy,
  ImagePlus,
  Loader2,
  Send,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { requestOperatorManualTopup } from "@/app/wallet/recharge-actions";
import {
  BRAND_GO,
  PartnerBackHeader,
  PartnerInlineError,
  SORA,
} from "@/components/shared/partner-ui";
import {
  PayCard,
  PayPrimaryButton,
  PayScreen,
  invalidatePayCache,
  payHref,
  usePayLang,
  usePayWallet,
  type PayBase,
} from "./pay-core";

/**
 * RECHARGER PAR VIREMENT CCP — flux guidé : étapes à suivre, coordonnées à
 * copier, montant exact, preuve, envoi. Se termine sur un écran « Demande
 * envoyée » dédié (vérification sous 24 h) au lieu d'un simple message.
 */
export function PayCcpTopup({ base }: { base: PayBase }) {
  const { lang, t, tr, dir } = usePayLang();
  const { state, config } = usePayWallet({ withConfig: true });

  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState<"ccp" | "rib" | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const submittingRef = useRef(false);

  const amt = Number(amount);
  const amtValid = Number.isFinite(amt) && amt >= 100;

  const copyVal = async (key: "ccp" | "rib", text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard indisponible */
    }
  };

  const submit = async () => {
    if (!amtValid || !file || !state || busy || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setErr(null);
    try {
      const supabase = createClient();
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${state.walletId}/${crypto.randomUUID()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from("wallet-proofs")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        setErr(`${tr.uploadFail} : ${upErr.message}`);
        return;
      }
      const res = await requestOperatorManualTopup({
        method: "virement",
        amountDa: amt,
        proofPath: path,
      });
      if (!res.ok) {
        setErr(res.error ?? tr.requestFail);
        return;
      }
      invalidatePayCache();
      setSent(true);
    } catch {
      setErr(tr.genericErr);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  /* ── Écran « Demande envoyée » (vérification en cours) ── */
  if (sent) {
    return (
      <section dir={dir} className="mx-auto w-full max-w-[560px]">
        <div className="rounded-sheet-xl border border-[var(--d-line)] bg-[var(--d-surface)] px-5 py-10 text-center">
          <CheckCircle2
            className="mx-auto size-12"
            style={{ color: BRAND_GO }}
          />
          <p
            className="text-heading-sm mt-4 font-extrabold text-[var(--d-ink)]"
            style={{ fontFamily: SORA }}
          >
            {t.sentTitle}
          </p>
          <p className="text-label-lg mt-1 leading-snug font-medium text-[var(--d-muted)]">
            {t.sentSub}
          </p>
          <div className="mt-5 space-y-2">
            <PayPrimaryButton href={payHref(base)}>
              {t.backToWallet}
            </PayPrimaryButton>
          </div>
        </div>
      </section>
    );
  }

  const steps = [tr.step1, tr.step2, tr.step3, tr.step4];

  return (
    <PayScreen dir={dir}>
      <PartnerBackHeader
        title={`${tr.mCcp} CCP`}
        subtitle={tr.mCcpDelay}
        href={payHref(base, "/methode")}
      />

      {/* Délai de traitement — l'info à connaître AVANT de commencer */}
      <div
        className="mb-3 flex items-start gap-2.5 rounded-lg p-3.5"
        style={{ background: "var(--d-accent)" }}
      >
        <Clock3
          className="mt-[1px] size-4 shrink-0"
          style={{ color: "var(--d-violet)" }}
        />
        <div className="min-w-0">
          <p className="text-label-lg font-extrabold text-[var(--d-ink)]">
            {t.delayTitle}
          </p>
          <p className="text-caption-lg leading-snug font-medium text-[var(--d-muted)]">
            {t.delaySub}
          </p>
        </div>
      </div>

      {/* Étapes à suivre */}
      <PayCard className="p-3.5">
        <p className="text-label-lg mb-2.5 font-bold text-[var(--d-muted)]">
          {t.stepsTitle}
        </p>
        <ol className="space-y-2.5">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span
                className="text-caption grid size-6 shrink-0 place-items-center rounded-full font-extrabold"
                style={{
                  background: "var(--d-accent)",
                  color: "var(--d-violet)",
                }}
              >
                {i + 1}
              </span>
              <span className="text-label-lg leading-snug font-semibold text-[var(--d-ink)]">
                {s}
              </span>
            </li>
          ))}
        </ol>
      </PayCard>

      {/* Coordonnées CCP (+ RIB bancaire si configuré) */}
      <PayCard className="mt-3 p-3.5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-caption-lg font-bold text-[var(--d-muted)]">
              {config?.ccpName || "Coligo"}
            </p>
            <p
              className="text-title-sm truncate font-extrabold text-[var(--d-ink)]"
              style={{ fontFamily: SORA }}
            >
              {config?.ccpNumber
                ? `${config.ccpNumber}${config.ccpKey ? ` · ${lang === "ar" ? "مفتاح" : "clé"} ${config.ccpKey}` : ""}`
                : tr.ccpUnset}
            </p>
            <p className="text-caption font-medium text-[var(--d-muted)]">
              {tr.ccpRef}
            </p>
          </div>
          {config?.ccpNumber && (
            <button
              type="button"
              aria-label={tr.copied}
              onClick={() =>
                void copyVal(
                  "ccp",
                  `${config.ccpNumber}${config.ccpKey ? ` clé ${config.ccpKey}` : ""}`
                )
              }
              className="grid size-10 shrink-0 place-items-center rounded-md border border-[var(--d-line)]"
              style={{ color: copied === "ccp" ? BRAND_GO : "var(--d-violet)" }}
            >
              {copied === "ccp" ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
            </button>
          )}
        </div>
        {config?.bankRib && (
          <div className="mt-3 flex items-center gap-3 border-t border-[var(--d-line)] pt-3">
            <div className="min-w-0 flex-1">
              <p className="text-caption-lg font-bold text-[var(--d-muted)]">
                {tr.bankLabel}
                {config.bankName ? ` · ${config.bankName}` : ""}
              </p>
              <p
                className="text-body-lg truncate font-extrabold text-[var(--d-ink)]"
                style={{ fontFamily: SORA }}
              >
                {config.bankRib}
              </p>
              <p className="text-caption font-medium text-[var(--d-muted)]">
                {tr.bankRibRef}
              </p>
            </div>
            <button
              type="button"
              aria-label={tr.copied}
              onClick={() => void copyVal("rib", config.bankRib ?? "")}
              className="grid size-10 shrink-0 place-items-center rounded-md border border-[var(--d-line)]"
              style={{ color: copied === "rib" ? BRAND_GO : "var(--d-violet)" }}
            >
              {copied === "rib" ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
            </button>
          </div>
        )}
      </PayCard>

      {/* Montant + preuve + envoi */}
      <PayCard className="mt-3 p-3.5">
        <input
          className="text-body w-full rounded-md border border-[var(--d-line)] bg-[var(--d-field)] px-3.5 py-3 font-bold text-[var(--d-ink)] outline-none placeholder:font-medium placeholder:text-[var(--d-muted)]"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
          inputMode="numeric"
          placeholder={tr.amountSent}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          hidden
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-card-lg mt-2.5 flex w-full flex-col items-center gap-1 border-2 border-dashed px-4 py-4 text-center"
          style={{
            borderColor: file ? BRAND_GO : "var(--d-line)",
            background: file ? "rgba(22,179,100,.06)" : "var(--d-surface)",
          }}
        >
          <span style={{ color: file ? BRAND_GO : "var(--d-violet)" }}>
            {file ? (
              <CheckCircle2 className="size-5" />
            ) : (
              <ImagePlus className="size-5" />
            )}
          </span>
          <span className="text-body-sm font-extrabold text-[var(--d-ink)]">
            {file ? tr.proofAdded : tr.addProof}
          </span>
          <span className="text-caption-lg font-medium text-[var(--d-muted)]">
            {file ? `${file.name} ${tr.proofReplace}` : tr.proofHint}
          </span>
        </button>
        <div className="mt-3">
          <PayPrimaryButton
            onClick={() => void submit()}
            disabled={!amtValid || !file || busy}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4 rtl:-scale-x-100" />
            )}
            {tr.sendRequest}
          </PayPrimaryButton>
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
