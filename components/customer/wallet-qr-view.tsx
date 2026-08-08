"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Keyboard,
  Loader2,
  Lock,
  QrCode,
  Send,
  ShieldCheck,
} from "lucide-react";
import { QrScanner } from "@/components/scanner/qr-scanner";
import { OrderQr } from "@/components/customer/order-qr";
import { PinResetPanel } from "@/components/customer/pin-reset-panel";
import { cn, formatDA } from "@/lib/utils";
import {
  executePayment,
  executeTransfer,
  getWalletPinStatus,
  resolvePayRequest,
  resolveReceiver,
  setWalletPin,
} from "@/app/(customer)/coligo-pay/qr/actions";

// =============================================================================
// WalletQrView — écran QR du wallet Coligo Pay (façon Alipay).
// =============================================================================
// Onglets Payer | Recevoir.
//  • PAYER  : scanner. Le QR scanné peut être :
//      - un QR COMMERÇANT (token de demande) → paiement marchand (montant figé)
//      - un QR AMI (coligo:user:<handle>)    → transfert P2P (montant saisi)
//  • RECEVOIR : mon QR personnel (handle stable) à montrer pour recevoir un
//    transfert ou se faire scanner.
//
// Boucle fermée : un transfert ne va que vers un autre compte Coligo Pay ; aucun
// retrait espèces/carte. Sécurité (PIN, idempotence, atomicité, anti
// double-dépense) entièrement côté SQL (migrations 0084/0085/0086).
// =============================================================================

type Tab = "pay" | "recv";
type Step = "scan" | "amount" | "confirm" | "success";

type Pending =
  | { kind: "pay"; token: string; name: string; amountDa: number; opId: string }
  | {
      kind: "transfer";
      handle: string;
      name: string;
      amountDa: number;
      opId: string;
    };

export function WalletQrView({
  customerName,
  myHandle,
  initialTab = "pay",
  hasPin: initialHasPin,
  locked,
  p2pEnabled = false,
}: {
  customerName: string;
  myHandle: string | null;
  initialTab?: Tab;
  hasPin: boolean;
  locked: boolean;
  // P2P off (défaut) → onglet « Recevoir » et transfert par QR ami MASQUÉS ;
  // seul le paiement marchand reste. Réversible (platform_settings.p2p_enabled).
  p2pEnabled?: boolean;
}) {
  const t = useTranslations("wallet");
  const router = useRouter();

  const [tab, setTab] = useState<Tab>(initialTab);
  const [hasPin, setHasPin] = useState(initialHasPin);
  const [lockedState, setLockedState] = useState(locked);
  const [showReset, setShowReset] = useState(false);
  const [step, setStep] = useState<Step>("scan");
  const [busy, setBusy] = useState(false);
  // Erreur d'action affichée EN LIGNE dans l'étape active (pas de toast).
  const [error, setError] = useState<string | null>(null);

  // RE-SYNCHRONISE le statut du PIN au montage : les props serveur peuvent
  // sortir du Router Cache (staleTimes) et dire « pas de PIN » alors qu'il en
  // existe un — c'était le bug « on me redemande de créer un code à chaque
  // fois » (et chaque re-création écrasait l'ancien). On n'applique QUE les
  // réponses sûres (known) : jamais de « crée un code » sur une erreur réseau.
  useEffect(() => {
    void getWalletPinStatus().then((s) => {
      if (!s.known) return;
      setHasPin(s.hasPin);
      setLockedState(s.locked);
    });
  }, []);

  const [codeMode, setCodeMode] = useState(false);
  const [codeInput, setCodeInput] = useState("");

  const [pending, setPending] = useState<Pending | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [pin, setPin] = useState("");
  const [receipt, setReceipt] = useState<{
    kind: "pay" | "transfer";
    name: string;
    amountDa: number;
  } | null>(null);

  const errMsg = useCallback(
    (code: string) => {
      const key =
        (
          {
            not_found: "qrErrNotFound",
            used: "qrErrUsed",
            expired: "qrErrExpired",
            insufficient: "qrErrInsufficient",
            self: "qrErrSelf",
            pin_wrong: "qrErrPinWrong",
            pin_locked: "qrErrPinLocked",
            pin_not_set: "qrErrPinNotSet",
          } as Record<string, string>
        )[code] ?? "qrErrGeneric";
      return t(key);
    },
    [t]
  );

  // ── Scan / saisie d'un QR (commerçant OU ami) ────────────────────────────
  const handleScan = useCallback(
    async (raw: string) => {
      if (busy || step !== "scan") return;
      const v = raw.trim();
      setError(null);
      setBusy(true);
      try {
        const userMatch = v.match(/^coligo:user:(.+)$/i);
        if (userMatch) {
          // QR ami → transfert P2P. Bloqué tant que le P2P n'est pas activé
          // (aucune surface de transfert d'argent exposée pour la review Play).
          if (!p2pEnabled) {
            setError(t("comingSoon"));
            return;
          }
          const handle = userMatch[1].trim();
          const res = await resolveReceiver(handle);
          if (!res.ok) {
            setError(
              res.error === "not_found"
                ? t("qrErrReceiverNotFound")
                : errMsg(res.error)
            );
            return;
          }
          setPending({
            kind: "transfer",
            handle,
            name: res.recipientName,
            amountDa: 0,
            opId: crypto.randomUUID(),
          });
          setAmountInput("");
          setPin("");
          setStep("amount");
          return;
        }
        // Sinon → token commerçant.
        const token = v.replace(/^coligo:pay:/i, "");
        if (token.length < 8) return;
        const res = await resolvePayRequest(token);
        if (!res.ok) {
          setError(errMsg(res.error));
          return;
        }
        setPending({
          kind: "pay",
          token,
          name: res.merchantName,
          amountDa: res.amountDa,
          opId: crypto.randomUUID(),
        });
        setPin("");
        setStep("confirm");
      } finally {
        setBusy(false);
      }
    },
    [busy, step, errMsg, t, p2pEnabled]
  );

  function confirmAmount() {
    if (!pending || pending.kind !== "transfer") return;
    setError(null);
    const amount = Math.floor(Number(amountInput));
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t("invalidAmount"));
      return;
    }
    setPending({ ...pending, amountDa: amount });
    setPin("");
    setStep("confirm");
  }

  async function confirmExecute() {
    if (!pending || pin.length !== 4) return;
    setError(null);
    setBusy(true);
    try {
      if (pending.kind === "pay") {
        const res = await executePayment({
          token: pending.token,
          pin,
          clientOperationId: pending.opId,
        });
        if (!res.ok) {
          setError(errMsg(res.error));
          if (["used", "expired", "not_found"].includes(res.error))
            resetToScan();
          else setPin("");
          return;
        }
        setReceipt({
          kind: "pay",
          name: res.merchantName,
          amountDa: res.amountDa,
        });
        setStep("success");
      } else {
        const res = await executeTransfer({
          handle: pending.handle,
          amountDa: pending.amountDa,
          pin,
          clientOperationId: pending.opId,
        });
        if (!res.ok) {
          setError(errMsg(res.error));
          if (["not_found", "self"].includes(res.error)) resetToScan();
          else setPin("");
          return;
        }
        setReceipt({
          kind: "transfer",
          name: res.recipientName,
          amountDa: res.amountDa,
        });
        setStep("success");
      }
    } finally {
      setBusy(false);
    }
  }

  function resetToScan() {
    setStep("scan");
    setError(null);
    setPending(null);
    setReceipt(null);
    setPin("");
    setAmountInput("");
    setCodeMode(false);
    setCodeInput("");
  }

  return (
    <div className="from-primary-600 to-primary-800 relative flex min-h-screen flex-col bg-gradient-to-b text-white">
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
        <h1 className="text-heading font-black">{t("qrTitle")}</h1>
      </header>

      {/* Sélecteur Payer/Recevoir : uniquement si le P2P est activé. Sinon
          l'écran est un pur scanner de paiement marchand (crédit fermé). */}
      {step === "scan" && p2pEnabled && (
        <div className="rounded-card-lg relative mx-4 mt-3 flex bg-white/15 p-1">
          <span
            className={cn(
              "rounded-control-lg absolute inset-y-1 start-1 w-[calc(50%-0.25rem)] bg-white transition-transform duration-300 ease-[cubic-bezier(.34,1.4,.64,1)]",
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
            <Send className="size-4 -scale-x-100" />
            {t("qrTabReceive")}
          </button>
        </div>
      )}

      {/* ── PAYER / ENVOYER : scanner ─────────────────────────────────────── */}
      {tab === "pay" && step === "scan" && (
        <div className="flex flex-1 flex-col items-center px-6 pt-6">
          {showReset ? (
            <div className="mt-4 w-full max-w-[320px]">
              <PinResetPanel
                onDone={() => {
                  setShowReset(false);
                  setHasPin(true);
                  setLockedState(false);
                  setError(null);
                }}
                onCancel={() => setShowReset(false)}
              />
            </div>
          ) : lockedState ? (
            <LockedPanel
              label={t("qrErrPinLocked")}
              forgotLabel={t("pinForgot")}
              onForgot={() => setShowReset(true)}
            />
          ) : !hasPin ? (
            <CreatePinPanel
              onCreated={() => setHasPin(true)}
              onExists={() => {
                // Un PIN existe déjà (état local périmé) : on bascule sur la
                // saisie — le serveur a refusé d'écraser (mig 0360).
                setHasPin(true);
                setError(t("qrErrPinExists"));
              }}
              labelTitle={t("qrCreatePinTitle")}
              labelDesc={t("qrCreatePinDesc")}
              labelPin={t("qrPinLabel")}
              labelConfirm={t("qrPinConfirmLabel")}
              labelCta={t("qrCreatePinCta")}
              msgMismatch={t("qrPinMismatch")}
              msgInvalid={t("qrErrPinNotSet")}
            />
          ) : (
            <>
              <QrScanner
                onScan={handleScan}
                oneShot={false}
                className="aspect-square w-full max-w-[240px] rounded-2xl"
              />
              <p className="text-body mt-6 max-w-[280px] text-center font-bold opacity-90">
                {t("qrScanAny")}
              </p>

              {error && (
                <p className="bg-danger-50 text-danger-700 text-label-lg mt-4 max-w-[280px] rounded-md px-3.5 py-2.5 text-center font-semibold">
                  {error}
                </p>
              )}

              {!codeMode ? (
                <button
                  type="button"
                  onClick={() => setCodeMode(true)}
                  className="rounded-card text-body-sm mt-6 inline-flex items-center gap-2 bg-white/15 px-5 py-3 font-extrabold"
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
                    className="text-foreground bg-surface rounded-card w-full px-3.5 py-3.5 text-center text-sm font-bold tracking-wider outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCodeMode(false);
                        setCodeInput("");
                      }}
                      className="h-11 flex-1 rounded-md bg-white/15 text-sm font-extrabold"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      disabled={busy || codeInput.trim().length < 8}
                      onClick={() => handleScan(codeInput)}
                      className="text-primary-700 inline-flex h-11 flex-1 items-center justify-center rounded-md bg-white text-sm font-extrabold disabled:opacity-50"
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

      {/* ── MONTANT (transfert P2P) ───────────────────────────────────────── */}
      {step === "amount" && pending?.kind === "transfer" && (
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10">
          <div className="bg-surface rounded-panel-lg shadow-overlay w-full max-w-[320px] p-6 text-center">
            <div className="bg-primary-50 text-primary-600 mx-auto grid size-14 place-items-center rounded-2xl">
              <Send className="size-7" />
            </div>
            <p className="text-muted text-label mt-4 font-bold tracking-wide uppercase">
              {t("qrSendTo")}
            </p>
            <p className="text-foreground mt-0.5 text-lg font-black">
              {pending.name}
            </p>
            <label className="text-muted text-caption-lg mt-5 block text-start font-extrabold tracking-wide uppercase">
              {t("qrAmountLabel")}
            </label>
            <div className="border-border bg-surface-2 focus-within:border-primary-400 rounded-card-lg mt-1.5 flex items-center gap-2 border px-4 py-3.5">
              <input
                inputMode="numeric"
                autoFocus
                value={amountInput}
                onChange={(e) =>
                  setAmountInput(e.target.value.replace(/\D/g, "").slice(0, 7))
                }
                placeholder="0"
                className="text-foreground w-full bg-transparent text-2xl font-black tabular-nums outline-none"
              />
              <span className="text-muted shrink-0 text-sm font-bold">DA</span>
            </div>
            {error && (
              <p className="text-danger-600 text-label-lg mt-3 font-semibold">
                {error}
              </p>
            )}
            <button
              type="button"
              disabled={amountInput === ""}
              onClick={confirmAmount}
              className="bg-primary-600 hover:bg-primary-700 rounded-card-lg text-title-sm mt-4 inline-flex h-12 w-full items-center justify-center gap-2 font-extrabold text-white disabled:opacity-40"
            >
              {t("qrContinue")}
              <ArrowRight className="size-4 rtl:-scale-x-100" />
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

      {/* ── CONFIRMATION + PIN ────────────────────────────────────────────── */}
      {step === "confirm" && pending && showReset && (
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10">
          <PinResetPanel
            onDone={() => {
              setShowReset(false);
              setLockedState(false);
              setPin("");
              setError(null);
            }}
            onCancel={() => setShowReset(false)}
          />
        </div>
      )}
      {step === "confirm" && pending && !showReset && (
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10">
          <div className="bg-surface rounded-panel-lg shadow-overlay w-full max-w-[320px] p-6 text-center">
            <div className="bg-primary-50 text-primary-600 mx-auto grid size-14 place-items-center rounded-2xl">
              {pending.kind === "pay" ? (
                <ShieldCheck className="size-7" />
              ) : (
                <Send className="size-7" />
              )}
            </div>
            <p className="text-muted text-label mt-4 font-bold tracking-wide uppercase">
              {pending.kind === "pay" ? t("qrPayTo") : t("qrSendTo")}
            </p>
            <p className="text-foreground mt-0.5 text-lg font-black">
              {pending.name}
            </p>
            <p className="text-primary-600 mt-2 text-[34px] leading-none font-black tabular-nums">
              {formatDA(pending.amountDa)}
            </p>

            <p className="text-muted text-body-sm mt-5 font-bold">
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
              className="border-border bg-surface-2 text-foreground placeholder:text-subtle focus:border-primary-400 rounded-card-lg mt-2 w-full border py-3.5 text-center text-2xl font-black tracking-[0.5em] tabular-nums outline-none"
            />

            {error && (
              <p className="text-danger-600 text-label-lg mt-2 font-semibold">
                {error}
              </p>
            )}

            <button
              type="button"
              disabled={busy || pin.length !== 4}
              onClick={confirmExecute}
              className="bg-primary-600 hover:bg-primary-700 rounded-card-xl text-title-sm mt-4 inline-flex h-[52px] w-full items-center justify-center gap-2 font-extrabold text-white disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="size-5 animate-spin" />
              ) : pending.kind === "pay" ? (
                t("qrPayNow", { amount: formatDA(pending.amountDa) })
              ) : (
                t("qrSendNow", { amount: formatDA(pending.amountDa) })
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowReset(true)}
              className="text-primary-600 text-label-lg mt-3 font-bold"
            >
              {t("pinForgot")}
            </button>
            <button
              type="button"
              onClick={resetToScan}
              className="text-muted mt-2 block w-full text-sm font-bold"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {/* ── REÇU ──────────────────────────────────────────────────────────── */}
      {step === "success" && receipt && (
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10">
          <div className="bg-surface rounded-panel-lg shadow-overlay w-full max-w-[320px] p-7 text-center">
            <div className="bg-success-100 text-success-700 mx-auto grid size-16 place-items-center rounded-full">
              <Check className="size-9" />
            </div>
            <p className="text-foreground mt-4 text-xl font-black">
              {receipt.kind === "pay"
                ? t("qrSuccessTitle")
                : t("qrTransferSuccessTitle")}
            </p>
            <p className="text-primary-600 mt-2 text-[34px] leading-none font-black tabular-nums">
              {formatDA(receipt.amountDa)}
            </p>
            <p className="text-muted text-body-sm mt-2 font-semibold">
              {t.rich(
                receipt.kind === "pay"
                  ? "qrSuccessDesc"
                  : "qrTransferSuccessDesc",
                {
                  merchant: receipt.name,
                  name: receipt.name,
                  b: (c) => (
                    <b className="text-foreground font-extrabold">{c}</b>
                  ),
                }
              )}
            </p>
            <button
              type="button"
              onClick={() => router.push("/coligo-pay")}
              className="bg-primary-600 hover:bg-primary-700 rounded-card-lg text-title-sm mt-6 inline-flex h-12 w-full items-center justify-center font-extrabold text-white"
            >
              {t("qrDone")}
            </button>
          </div>
        </div>
      )}

      {/* ── RECEVOIR : mon QR personnel (actif) ───────────────────────────── */}
      {tab === "recv" && step === "scan" && (
        <div className="flex flex-1 flex-col items-center px-6 pt-6">
          <div className="rounded-panel-lg shadow-overlay w-[236px] bg-white p-5 text-center">
            {myHandle ? (
              <div className="mx-auto w-fit">
                <OrderQr value={`coligo:user:${myHandle}`} size={180} />
              </div>
            ) : (
              <div className="text-muted grid h-[180px] place-items-center text-sm">
                <Loader2 className="size-6 animate-spin" />
              </div>
            )}
            <p className="text-foreground text-title-sm mt-4 font-black">
              {customerName}
            </p>
            {myHandle && (
              <p className="text-muted mt-0.5 text-xs font-bold tracking-wider tabular-nums">
                {t("qrMyQrName")} · {myHandle}
              </p>
            )}
          </div>
          <p className="text-body-sm mt-5 max-w-[300px] text-center font-bold opacity-90">
            {t("qrShowToReceive")}
          </p>
        </div>
      )}

      <div className="h-[env(safe-area-inset-bottom)]" />
    </div>
  );
}

function LockedPanel({
  label,
  forgotLabel,
  onForgot,
}: {
  label: string;
  forgotLabel?: string;
  onForgot?: () => void;
}) {
  return (
    <div className="mt-10 flex flex-col items-center text-center">
      <span className="grid size-16 place-items-center rounded-full bg-white/15">
        <Lock className="size-8" />
      </span>
      <p className="text-body-lg mt-4 max-w-[260px] font-bold opacity-90">
        {label}
      </p>
      {/* Sortie de secours : le reset par email LÈVE aussi le verrouillage. */}
      {onForgot && forgotLabel && (
        <button
          type="button"
          onClick={onForgot}
          className="rounded-card text-body-sm mt-4 bg-white/15 px-5 py-3 font-extrabold"
        >
          {forgotLabel}
        </button>
      )}
    </div>
  );
}

function CreatePinPanel({
  onCreated,
  onExists,
  labelTitle,
  labelDesc,
  labelPin,
  labelConfirm,
  labelCta,
  msgMismatch,
  msgInvalid,
}: {
  onCreated: () => void;
  /** Le serveur signale qu'un PIN existe déjà (état local périmé) — mig 0360
   *  refuse d'écraser : l'appelant bascule sur la saisie du PIN existant. */
  onExists?: () => void;
  labelTitle: string;
  labelDesc: string;
  labelPin: string;
  labelConfirm: string;
  labelCta: string;
  msgMismatch: string;
  msgInvalid: string;
}) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  // Erreur EN LIGNE dans la carte de création du PIN (pas de toast).
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!/^\d{4}$/.test(pin)) {
      setErr(msgInvalid);
      return;
    }
    if (pin !== confirm) {
      setErr(msgMismatch);
      return;
    }
    setBusy(true);
    const res = await setWalletPin(pin);
    setBusy(false);
    if (!res.ok) {
      if (res.error === "pin_exists" && onExists) {
        onExists();
        return;
      }
      setErr(msgInvalid);
      return;
    }
    // Succès : onCreated() bascule vers le scanner (retour visuel).
    onCreated();
  }

  return (
    <div className="bg-surface rounded-panel-lg shadow-overlay mt-4 w-full max-w-[320px] p-6 text-center">
      <div className="bg-primary-50 text-primary-600 mx-auto grid size-14 place-items-center rounded-2xl">
        <Lock className="size-7" />
      </div>
      <p className="text-foreground mt-4 text-lg font-black">{labelTitle}</p>
      <p className="text-muted text-body-sm mt-1 font-medium">{labelDesc}</p>

      <label className="text-muted text-caption-lg mt-5 block text-start font-extrabold tracking-wide uppercase">
        {labelPin}
      </label>
      <input
        inputMode="numeric"
        value={pin}
        onChange={(e) => {
          setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
          setErr(null);
        }}
        placeholder="••••"
        className="border-border bg-surface-2 text-foreground placeholder:text-subtle focus:border-primary-400 rounded-card mt-1.5 w-full border py-3.5 text-center text-2xl font-black tracking-[0.5em] tabular-nums outline-none"
      />
      <label className="text-muted text-caption-lg mt-3 block text-start font-extrabold tracking-wide uppercase">
        {labelConfirm}
      </label>
      <input
        inputMode="numeric"
        value={confirm}
        onChange={(e) => {
          setConfirm(e.target.value.replace(/\D/g, "").slice(0, 4));
          setErr(null);
        }}
        placeholder="••••"
        className="border-border bg-surface-2 text-foreground placeholder:text-subtle focus:border-primary-400 rounded-card mt-1.5 w-full border py-3.5 text-center text-2xl font-black tracking-[0.5em] tabular-nums outline-none"
      />
      {err && (
        <p className="text-danger-600 text-label-lg mt-2 font-semibold">
          {err}
        </p>
      )}
      <button
        type="button"
        disabled={busy || pin.length !== 4 || confirm.length !== 4}
        onClick={save}
        className="bg-primary-600 hover:bg-primary-700 rounded-card-lg text-title-sm mt-5 inline-flex h-12 w-full items-center justify-center gap-2 font-extrabold text-white disabled:opacity-40"
      >
        {busy ? <Loader2 className="size-5 animate-spin" /> : labelCta}
      </button>
    </div>
  );
}
