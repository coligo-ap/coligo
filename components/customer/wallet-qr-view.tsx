"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Check,
  ChevronLeft,
  Clock,
  Keyboard,
  Loader2,
  Lock,
  Plus,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { QrScanner } from "@/components/scanner/qr-scanner";
import { OrderQr } from "@/components/customer/order-qr";
import { toast } from "@/components/ui/toast";
import { cn, formatDA } from "@/lib/utils";
import {
  executePayment,
  resolvePayRequest,
  setWalletPin,
  type ResolvedRequest,
} from "@/app/(customer)/coligo-pay/qr/actions";

// =============================================================================
// WalletQrView — écran QR du wallet Coligo Pay (façon Alipay).
// =============================================================================
// Onglets Payer | Recevoir. Flux PAYER (MVP, paiement marchand) :
//   1. Si pas de PIN → création d'un code Coligo Pay (4 chiffres).
//   2. Scan du QR marchand (ou saisie du code) → résolution serveur (montant +
//      commerçant) → écran de confirmation.
//   3. Confirmation : saisie du PIN → exécution serveur (atomique, idempotente).
//   4. Reçu.
// RECEVOIR (P2P) : GELÉ — « Bientôt disponible » (licence Banque d'Algérie).
// Toute la sécurité est côté SQL (migration 0084) ; ce composant n'orchestre
// que l'UX. L'idempotency key est générée par paiement et réutilisée au retry.
// =============================================================================

type Tab = "pay" | "recv";
type Step = "scan" | "confirm" | "success";

export function WalletQrView({
  customerName,
  identifier,
  initialTab = "pay",
  hasPin: initialHasPin,
  locked,
}: {
  customerName: string;
  identifier: string;
  initialTab?: Tab;
  hasPin: boolean;
  locked: boolean;
}) {
  const t = useTranslations("wallet");
  const router = useRouter();

  const [tab, setTab] = useState<Tab>(initialTab);
  const [hasPin, setHasPin] = useState(initialHasPin);
  const [step, setStep] = useState<Step>("scan");
  const [busy, setBusy] = useState(false);

  const [codeMode, setCodeMode] = useState(false);
  const [codeInput, setCodeInput] = useState("");

  const [pending, setPending] = useState<{
    token: string;
    merchantName: string;
    amountDa: number;
    opId: string;
  } | null>(null);
  const [pin, setPin] = useState("");
  const [receipt, setReceipt] = useState<{
    merchantName: string;
    amountDa: number;
  } | null>(null);

  const errMsg = useCallback(
    (code: string) => {
      const key =
        {
          not_found: "qrErrNotFound",
          used: "qrErrUsed",
          expired: "qrErrExpired",
          insufficient: "qrErrInsufficient",
          pin_wrong: "qrErrPinWrong",
          pin_locked: "qrErrPinLocked",
          pin_not_set: "qrErrPinNotSet",
          not_customer: "qrErrGeneric",
        }[code] ?? "qrErrGeneric";
      return t(key);
    },
    [t]
  );

  // ── Résolution d'un token (scan ou saisie) ───────────────────────────────
  const handleToken = useCallback(
    async (raw: string) => {
      if (busy || step !== "scan") return;
      const token = raw.trim().replace(/^coligo:pay:/i, "");
      if (token.length < 8) return;
      setBusy(true);
      const res: ResolvedRequest = await resolvePayRequest(token);
      setBusy(false);
      if (!res.ok) {
        toast.error(errMsg(res.error));
        return;
      }
      setPending({
        token,
        merchantName: res.merchantName,
        amountDa: res.amountDa,
        opId: crypto.randomUUID(),
      });
      setPin("");
      setStep("confirm");
    },
    [busy, step, errMsg]
  );

  // ── Paiement (confirmation + PIN) ────────────────────────────────────────
  async function confirmPay() {
    if (!pending || pin.length !== 4) return;
    setBusy(true);
    const res = await executePayment({
      token: pending.token,
      pin,
      clientOperationId: pending.opId,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(errMsg(res.error));
      // Token consommé / expiré → on repart au scan.
      if (["used", "expired", "not_found"].includes(res.error)) {
        setStep("scan");
        setPending(null);
      } else {
        setPin("");
      }
      return;
    }
    setReceipt({ merchantName: res.merchantName, amountDa: res.amountDa });
    setStep("success");
  }

  function resetToScan() {
    setStep("scan");
    setPending(null);
    setReceipt(null);
    setPin("");
    setCodeMode(false);
    setCodeInput("");
  }

  return (
    <div className="from-primary-600 to-primary-800 relative flex min-h-screen flex-col bg-gradient-to-b text-white">
      {/* En-tête */}
      <header className="flex items-center gap-3 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-1.5">
        <button
          type="button"
          onClick={() =>
            step === "scan" ? router.push("/coligo-pay") : resetToScan()
          }
          aria-label={t("qrTitle")}
          className="grid size-9 place-items-center rounded-full bg-white/20 transition-transform active:scale-90"
        >
          <ChevronLeft className="size-[18px] rtl:-scale-x-100" />
        </button>
        <h1 className="text-[19px] font-black">{t("qrTitle")}</h1>
      </header>

      {/* Onglets : visibles seulement à l'étape scan */}
      {step === "scan" && (
        <div className="relative mx-4 mt-3 flex rounded-[14px] bg-white/15 p-1">
          <span
            className={cn(
              "absolute inset-y-1 start-1 w-[calc(50%-0.25rem)] rounded-[11px] bg-white transition-transform duration-300 ease-[cubic-bezier(.34,1.4,.64,1)]",
              tab === "recv" && "translate-x-full rtl:-translate-x-full"
            )}
          />
          <button
            type="button"
            onClick={() => setTab("pay")}
            className={cn(
              "relative z-10 flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-extrabold transition-colors",
              tab === "pay" ? "text-primary-700" : "text-white/80"
            )}
          >
            <QrCode className="size-4" />
            {t("qrTabPay")}
          </button>
          <button
            type="button"
            onClick={() => setTab("recv")}
            className={cn(
              "relative z-10 flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-extrabold transition-colors",
              tab === "recv" ? "text-primary-700" : "text-white/80"
            )}
          >
            <Plus className="size-4" />
            {t("qrTabReceive")}
          </button>
        </div>
      )}

      {/* ── PAYER ───────────────────────────────────────────────────────── */}
      {tab === "pay" && step === "scan" && (
        <div className="flex flex-1 flex-col items-center px-6 pt-6">
          {locked ? (
            <LockedPanel t={t} />
          ) : !hasPin ? (
            <CreatePinPanel
              onCreated={() => setHasPin(true)}
              labelTitle={t("qrCreatePinTitle")}
              labelDesc={t("qrCreatePinDesc")}
              labelPin={t("qrPinLabel")}
              labelConfirm={t("qrPinConfirmLabel")}
              labelCta={t("qrCreatePinCta")}
              msgMismatch={t("qrPinMismatch")}
              msgSaved={t("qrPinSaved")}
              msgInvalid={t("qrErrPinNotSet")}
            />
          ) : (
            <>
              <QrScanner
                onScan={handleToken}
                oneShot={false}
                className="aspect-square w-full max-w-[240px] rounded-[28px]"
              />
              <p className="mt-6 max-w-[280px] text-center text-[13.5px] font-bold opacity-90">
                {t("qrScanMerchant")}
              </p>

              {!codeMode ? (
                <button
                  type="button"
                  onClick={() => setCodeMode(true)}
                  className="mt-6 inline-flex items-center gap-2 rounded-[13px] bg-white/15 px-5 py-3 text-[13px] font-extrabold"
                >
                  <Keyboard className="size-4" />
                  {t("qrEnterCode")}
                </button>
              ) : (
                <div className="mt-6 w-full max-w-[280px] space-y-2.5">
                  <input
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                    placeholder={t("qrEnterCodePlaceholder")}
                    autoCapitalize="characters"
                    className="text-foreground w-full rounded-[13px] bg-white px-3.5 py-3.5 text-center text-sm font-bold tracking-wider outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCodeMode(false);
                        setCodeInput("");
                      }}
                      className="h-11 flex-1 rounded-[12px] bg-white/15 text-sm font-extrabold"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      disabled={busy || codeInput.trim().length < 8}
                      onClick={() => handleToken(codeInput)}
                      className="text-primary-700 inline-flex h-11 flex-1 items-center justify-center rounded-[12px] bg-white text-sm font-extrabold disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        t("qrValidate")
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── CONFIRMATION + PIN ──────────────────────────────────────────── */}
      {step === "confirm" && pending && (
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10">
          <div className="w-full max-w-[320px] rounded-[26px] bg-white p-6 text-center text-[var(--color-foreground)] shadow-[0_20px_50px_-16px_rgba(0,0,0,.4)]">
            <div className="bg-primary-50 text-primary-600 mx-auto grid size-14 place-items-center rounded-2xl">
              <ShieldCheck className="size-7" />
            </div>
            <p className="text-muted mt-4 text-[12px] font-bold tracking-wide uppercase">
              {t("qrPayTo")}
            </p>
            <p className="text-foreground mt-0.5 text-lg font-black">
              {pending.merchantName}
            </p>
            <p className="text-primary-600 mt-2 text-[34px] leading-none font-black tabular-nums">
              {formatDA(pending.amountDa)}
            </p>

            <p className="text-muted mt-5 text-[13px] font-bold">
              {t("qrEnterPin")}
            </p>
            <input
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) =>
                setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              placeholder="••••"
              className="border-border bg-surface-2 focus:border-primary-400 mt-2 w-full rounded-[14px] border py-3.5 text-center text-2xl font-black tracking-[0.5em] tabular-nums outline-none"
            />

            <button
              type="button"
              disabled={busy || pin.length !== 4}
              onClick={confirmPay}
              className="bg-primary-600 hover:bg-primary-700 mt-4 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[15px] text-[15px] font-extrabold text-white disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                t("qrPayNow", { amount: formatDA(pending.amountDa) })
              )}
            </button>
            <button
              type="button"
              onClick={resetToScan}
              className="text-muted mt-3 text-sm font-bold"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {/* ── REÇU ────────────────────────────────────────────────────────── */}
      {step === "success" && receipt && (
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10">
          <div className="w-full max-w-[320px] rounded-[26px] bg-white p-7 text-center shadow-[0_20px_50px_-16px_rgba(0,0,0,.4)]">
            <div className="bg-success-100 text-success-700 mx-auto grid size-16 place-items-center rounded-full">
              <Check className="size-9" />
            </div>
            <p className="text-foreground mt-4 text-xl font-black">
              {t("qrSuccessTitle")}
            </p>
            <p className="text-primary-600 mt-2 text-[34px] leading-none font-black tabular-nums">
              {formatDA(receipt.amountDa)}
            </p>
            <p className="text-muted mt-2 text-[13px] font-semibold">
              {t.rich("qrSuccessDesc", {
                merchant: receipt.merchantName,
                b: (c) => <b className="text-foreground font-extrabold">{c}</b>,
              })}
            </p>
            <button
              type="button"
              onClick={() => router.push("/coligo-pay")}
              className="bg-primary-600 hover:bg-primary-700 mt-6 inline-flex h-12 w-full items-center justify-center rounded-[14px] text-[15px] font-extrabold text-white"
            >
              {t("qrDone")}
            </button>
          </div>
        </div>
      )}

      {/* ── RECEVOIR : QR personnel (gelé — bientôt disponible) ──────────── */}
      {tab === "recv" && step === "scan" && (
        <div className="flex flex-1 flex-col items-center px-6 pt-6">
          <div className="relative w-[236px] rounded-[26px] bg-white p-5 text-center shadow-[0_20px_50px_-16px_rgba(0,0,0,.4)]">
            <div className="pointer-events-none opacity-40 blur-[2px] select-none">
              <div className="mx-auto w-fit">
                <OrderQr value={`coligo:recv:${identifier}`} size={170} />
              </div>
            </div>
            <span className="bg-primary-600 absolute top-1/2 left-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-extrabold whitespace-nowrap text-white shadow-lg">
              <Clock className="size-3.5" />
              {t("qrComingSoon")}
            </span>
            <p className="text-foreground mt-4 text-[15px] font-black">
              {customerName}
            </p>
            <p className="text-muted mt-0.5 text-xs font-medium">
              {t("qrMyQrName")} · {identifier}
            </p>
          </div>
          <p className="mt-5 max-w-[300px] text-center text-[13px] font-bold opacity-90">
            {t("qrReceiveComingSoonDesc")}
          </p>
        </div>
      )}

      <div className="h-[env(safe-area-inset-bottom)]" />
    </div>
  );
}

// ── Panneau : wallet verrouillé (trop d'essais PIN) ────────────────────────
function LockedPanel({ t }: { t: (k: string) => string }) {
  return (
    <div className="mt-10 flex flex-col items-center text-center">
      <span className="grid size-16 place-items-center rounded-full bg-white/15">
        <Lock className="size-8" />
      </span>
      <p className="mt-4 max-w-[260px] text-[14px] font-bold opacity-90">
        {t("qrErrPinLocked")}
      </p>
    </div>
  );
}

// ── Panneau : création du PIN Coligo Pay ───────────────────────────────────
function CreatePinPanel({
  onCreated,
  labelTitle,
  labelDesc,
  labelPin,
  labelConfirm,
  labelCta,
  msgMismatch,
  msgSaved,
  msgInvalid,
}: {
  onCreated: () => void;
  labelTitle: string;
  labelDesc: string;
  labelPin: string;
  labelConfirm: string;
  labelCta: string;
  msgMismatch: string;
  msgSaved: string;
  msgInvalid: string;
}) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!/^\d{4}$/.test(pin)) {
      toast.error(msgInvalid);
      return;
    }
    if (pin !== confirm) {
      toast.error(msgMismatch);
      return;
    }
    setBusy(true);
    const res = await setWalletPin(pin);
    setBusy(false);
    if (!res.ok) {
      toast.error(msgInvalid);
      return;
    }
    toast.success(msgSaved);
    onCreated();
  }

  return (
    <div className="mt-4 w-full max-w-[320px] rounded-[26px] bg-white p-6 text-center text-[var(--color-foreground)] shadow-[0_20px_50px_-16px_rgba(0,0,0,.4)]">
      <div className="bg-primary-50 text-primary-600 mx-auto grid size-14 place-items-center rounded-2xl">
        <Lock className="size-7" />
      </div>
      <p className="text-foreground mt-4 text-lg font-black">{labelTitle}</p>
      <p className="text-muted mt-1 text-[13px] font-medium">{labelDesc}</p>

      <label className="text-muted mt-5 block text-start text-[11.5px] font-extrabold tracking-wide uppercase">
        {labelPin}
      </label>
      <input
        inputMode="numeric"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
        placeholder="••••"
        className="border-border bg-surface-2 focus:border-primary-400 mt-1.5 w-full rounded-[13px] border py-3.5 text-center text-2xl font-black tracking-[0.5em] tabular-nums outline-none"
      />
      <label className="text-muted mt-3 block text-start text-[11.5px] font-extrabold tracking-wide uppercase">
        {labelConfirm}
      </label>
      <input
        inputMode="numeric"
        value={confirm}
        onChange={(e) =>
          setConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))
        }
        placeholder="••••"
        className="border-border bg-surface-2 focus:border-primary-400 mt-1.5 w-full rounded-[13px] border py-3.5 text-center text-2xl font-black tracking-[0.5em] tabular-nums outline-none"
      />
      <button
        type="button"
        disabled={busy || pin.length !== 4 || confirm.length !== 4}
        onClick={save}
        className="bg-primary-600 hover:bg-primary-700 mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] text-[15px] font-extrabold text-white disabled:opacity-40"
      >
        {busy ? <Loader2 className="size-5 animate-spin" /> : labelCta}
      </button>
    </div>
  );
}
