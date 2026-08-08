"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Mail, ShieldCheck } from "lucide-react";
import {
  requestPinResetCode,
  resetPinWithEmailCode,
} from "@/app/(customer)/coligo-pay/qr/actions";

/**
 * « Code PIN oublié ? » — récupération par EMAIL (partagé QR + envoyer) :
 *  1. envoi d'un code de vérification à l'adresse du compte (jamais choisie
 *     par le client) ;
 *  2. saisie du code + du nouveau PIN (double saisie).
 * La preuve email et le reset sont côté serveur (verifyOtp + fonction
 * service_role, mig 0360) ; ici uniquement l'orchestration et les messages
 * INLINE (pas de toast). Anti-abus : 60 s entre envois, verrouillage aux
 * codes faux — les messages reflètent l'erreur exacte.
 */
export function PinResetPanel({
  onDone,
  onCancel,
}: {
  /** Appelé quand le nouveau PIN est posé (l'appelant re-synchronise). */
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("wallet");
  const [step, setStep] = useState<"send" | "code">("send");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function errText(codeStr: string): string {
    if (codeStr.startsWith("locked:")) {
      return t("pinResetLocked", { minutes: codeStr.slice(7) || "10" });
    }
    switch (codeStr) {
      case "wait":
        return t("pinResetWait");
      case "too_many_sends":
        return t("pinResetTooMany");
      case "bad_code":
        return t("pinResetBadCode");
      case "invalid_pin":
        return t("qrErrPinNotSet");
      default:
        return t("pinResetSendFailed");
    }
  }

  async function send() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await requestPinResetCode();
    setBusy(false);
    if (!res.ok) {
      setError(errText(res.error));
      return;
    }
    setSentTo(res.email);
    setStep("code");
  }

  async function submit() {
    if (busy) return;
    setError(null);
    if (!/^\d{4}$/.test(pin)) {
      setError(t("qrErrPinNotSet"));
      return;
    }
    if (pin !== confirm) {
      setError(t("qrPinMismatch"));
      return;
    }
    setBusy(true);
    const res = await resetPinWithEmailCode({ code, newPin: pin });
    setBusy(false);
    if (!res.ok) {
      setError(errText(res.error));
      return;
    }
    setDone(true);
    // Petit délai de lecture du succès puis retour à la saisie du PIN.
    setTimeout(onDone, 900);
  }

  const inputCls =
    "border-border bg-surface-2 text-foreground placeholder:text-subtle focus:border-primary-400 mt-1.5 w-full rounded-card border py-3 text-center font-black tabular-nums outline-none";

  return (
    <div className="bg-surface rounded-panel-lg shadow-overlay w-full max-w-[320px] p-6 text-center">
      <div className="bg-primary-50 text-primary-600 mx-auto grid size-14 place-items-center rounded-2xl">
        {step === "send" ? (
          <Mail className="size-7" />
        ) : (
          <ShieldCheck className="size-7" />
        )}
      </div>
      <p className="text-foreground mt-4 text-lg font-black">
        {t("pinResetTitle")}
      </p>

      {done ? (
        <p className="text-success-700 text-body mt-3 font-bold">
          {t("pinResetDone")}
        </p>
      ) : step === "send" ? (
        <>
          <p className="text-muted text-body-sm mt-1 font-medium">
            {t("pinResetDesc")}
          </p>
          {error && (
            <p className="text-danger-600 text-label-lg mt-3 font-semibold">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={send}
            className="bg-primary-600 hover:bg-primary-700 rounded-card-lg text-title-sm mt-5 inline-flex h-12 w-full items-center justify-center gap-2 font-extrabold text-white disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              t("pinResetSend")
            )}
          </button>
        </>
      ) : (
        <>
          {sentTo && (
            <p className="text-muted text-label-lg mt-1 font-medium">
              {t("pinResetSent", { email: sentTo })}
            </p>
          )}
          <label className="text-muted text-caption-lg mt-4 block text-start font-extrabold tracking-wide uppercase">
            {t("pinResetCodeLabel")}
          </label>
          <input
            inputMode="numeric"
            autoFocus
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setError(null);
            }}
            placeholder="••••••"
            className={`${inputCls} text-xl tracking-[0.35em]`}
          />
          <label className="text-muted text-caption-lg mt-3 block text-start font-extrabold tracking-wide uppercase">
            {t("pinResetNewLabel")}
          </label>
          <input
            inputMode="numeric"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
              setError(null);
            }}
            placeholder="••••"
            className={`${inputCls} text-2xl tracking-[0.5em]`}
          />
          <label className="text-muted text-caption-lg mt-3 block text-start font-extrabold tracking-wide uppercase">
            {t("pinResetConfirmLabel")}
          </label>
          <input
            inputMode="numeric"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value.replace(/\D/g, "").slice(0, 4));
              setError(null);
            }}
            placeholder="••••"
            className={`${inputCls} text-2xl tracking-[0.5em]`}
          />
          {error && (
            <p className="text-danger-600 text-label-lg mt-2 font-semibold">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={
              busy ||
              code.length < 6 ||
              pin.length !== 4 ||
              confirm.length !== 4
            }
            onClick={submit}
            className="bg-primary-600 hover:bg-primary-700 rounded-card-lg text-title-sm mt-4 inline-flex h-12 w-full items-center justify-center gap-2 font-extrabold text-white disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              t("pinResetCta")
            )}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={send}
            className="text-primary-600 text-label-lg mt-3 font-bold disabled:opacity-40"
          >
            {t("pinResetSend")}
          </button>
        </>
      )}

      {!done && (
        <button
          type="button"
          onClick={onCancel}
          className="text-muted mt-3 block w-full text-sm font-bold"
        >
          {t("pinResetBack")}
        </button>
      )}
    </div>
  );
}
