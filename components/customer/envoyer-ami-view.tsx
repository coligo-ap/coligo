"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Delete,
  Loader2,
  Lock,
  Search,
  Send,
  ShieldCheck,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { PinResetPanel } from "@/components/customer/pin-reset-panel";
import {
  executeTransfer,
  getWalletPinStatus,
  searchRecipient,
  setWalletPin,
  type RecentRecipient,
} from "@/app/(customer)/coligo-pay/qr/actions";

// =============================================================================
// EnvoyerAmiView — « Envoyer à un ami » (transfert P2P Coligo Pay).
// 3 écrans : recherche → montant (clavier) → confirmation (récap + PIN).
// Boucle fermée ; toute la sécurité (PIN, idempotence, anti double-dépense,
// double-entrée) est côté SQL (coligo_pay_transfer). En-tête de sous-page +
// nav bas (fournie par CustomerShell hideHeader).
// =============================================================================

const GRADIENTS = [
  "from-[#8B82FF] to-[#5B5BE6]",
  "from-[#FF8A65] to-[#FF5A3C]",
  "from-[#4FC3A1] to-[#15915A]",
  "from-[#FFB02E] to-[#C77A18]",
  "from-[#7E9BFF] to-[#3E3AB8]",
];
function avatarGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}
function initial(name: string): string {
  return (name.trim().charAt(0) || "?").toUpperCase();
}

type Step = "search" | "amount" | "confirm" | "success";
type Recipient = { handle: string; name: string };

export function EnvoyerAmiView({
  senderName,
  balanceDa,
  recents,
  hasPin: initialHasPin,
  locked,
}: {
  senderName: string;
  balanceDa: number;
  recents: RecentRecipient[];
  hasPin: boolean;
  locked: boolean;
}) {
  const t = useTranslations("wallet");
  const router = useRouter();

  const [step, setStep] = useState<Step>("search");
  const [busy, setBusy] = useState(false);
  // Erreur d'action affichée EN LIGNE dans l'étape active (pas de toast).
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState("");
  const [hasPin, setHasPin] = useState(initialHasPin);
  const [lockedState, setLockedState] = useState(locked);
  const [showReset, setShowReset] = useState(false);
  const [opId, setOpId] = useState("");

  // RE-SYNCHRONISE le statut du PIN au montage (props RSC possiblement
  // périmées via le Router Cache) — cf. wallet-qr-view : jamais « crée un
  // code » sur une simple erreur réseau.
  useEffect(() => {
    void getWalletPinStatus().then((s) => {
      if (!s.known) return;
      setHasPin(s.hasPin);
      setLockedState(s.locked);
    });
  }, []);

  const amountNum = Number(amount) || 0;

  function errMsg(code: string) {
    const key =
      (
        {
          not_found: "sendNotFound",
          self: "qrErrSelf",
          insufficient: "qrErrInsufficient",
          pin_wrong: "qrErrPinWrong",
          pin_locked: "qrErrPinLocked",
          pin_not_set: "qrErrPinNotSet",
          too_short: "sendSearchHint",
        } as Record<string, string>
      )[code] ?? "qrErrGeneric";
    return t(key);
  }

  function pick(r: Recipient) {
    setError(null);
    setRecipient(r);
    setAmount("");
    setNote("");
    setPin("");
    setOpId(crypto.randomUUID());
    setStep("amount");
  }

  async function doSearch() {
    const q = query.trim();
    if (q.length < 4) return;
    setError(null);
    setBusy(true);
    const res = await searchRecipient(q);
    setBusy(false);
    if (!res.ok) {
      setError(errMsg(res.error));
      return;
    }
    pick({ handle: res.handle, name: res.name });
  }

  function goConfirm() {
    setError(null);
    if (amountNum <= 0) {
      setError(t("invalidAmount"));
      return;
    }
    if (amountNum > balanceDa) {
      setError(t("qrErrInsufficient"));
      return;
    }
    setPin("");
    setStep("confirm");
  }

  async function doSend() {
    if (!recipient || pin.length !== 4) return;
    setError(null);
    setBusy(true);
    const res = await executeTransfer({
      handle: recipient.handle,
      amountDa: amountNum,
      pin,
      clientOperationId: opId,
      note: note.trim() || null,
    });
    setBusy(false);
    if (!res.ok) {
      setError(errMsg(res.error));
      if (["not_found", "self"].includes(res.error)) {
        setStep("search");
        setRecipient(null);
      } else setPin("");
      return;
    }
    setStep("success");
  }

  return (
    <div className="bg-surface-2 flex min-h-screen flex-col pb-24">
      {/* En-tête de sous-page */}
      <header className="border-border sticky top-0 z-20 flex items-center gap-3 border-b bg-white px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3">
        <button
          type="button"
          aria-label={t("qrTitle")}
          onClick={() => {
            setError(null);
            if (step === "search") router.push("/coligo-pay");
            else if (step === "amount") setStep("search");
            else if (step === "confirm") setStep("amount");
            else router.push("/coligo-pay");
          }}
          className="bg-surface-2 grid size-9 place-items-center rounded-full transition-transform active:scale-90"
        >
          <ChevronLeft className="size-[18px] rtl:-scale-x-100" />
        </button>
        <h1 className="text-heading font-black tracking-tight">
          {step === "amount"
            ? t("sendAmountTitle")
            : step === "confirm"
              ? t("sendConfirmTitle")
              : t("sendFriendTitle")}
        </h1>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">
        {step === "search" && (
          <SearchStep
            t={t}
            query={query}
            setQuery={setQuery}
            busy={busy}
            onSearch={doSearch}
            recents={recents}
            onPick={pick}
            error={error}
          />
        )}

        {step === "amount" && recipient && (
          <AmountStep
            t={t}
            recipient={recipient}
            amount={amount}
            setAmount={setAmount}
            note={note}
            setNote={setNote}
            balanceDa={balanceDa}
            onContinue={goConfirm}
            error={error}
          />
        )}

        {step === "confirm" && recipient && showReset && (
          <div className="flex justify-center pt-4">
            <PinResetPanel
              onDone={() => {
                setShowReset(false);
                setHasPin(true);
                setLockedState(false);
                setPin("");
                setError(null);
              }}
              onCancel={() => setShowReset(false)}
            />
          </div>
        )}
        {step === "confirm" && recipient && !showReset && (
          <ConfirmStep
            t={t}
            senderName={senderName}
            recipient={recipient}
            amountNum={amountNum}
            note={note}
            balanceDa={balanceDa}
            locked={lockedState}
            hasPin={hasPin}
            onPinCreated={() => setHasPin(true)}
            onForgot={() => setShowReset(true)}
            pin={pin}
            setPin={setPin}
            busy={busy}
            onSend={doSend}
            error={error}
          />
        )}

        {step === "success" && recipient && (
          <div className="flex flex-col items-center justify-center pt-16 text-center">
            <div className="bg-success-100 text-success-700 grid size-16 place-items-center rounded-full">
              <Check className="size-9" />
            </div>
            <p className="text-foreground mt-4 text-xl font-black">
              {t("sendSuccessTitle")}
            </p>
            <p className="text-primary-600 mt-2 text-[34px] leading-none font-black tabular-nums">
              {formatDA(amountNum)}
            </p>
            <p className="text-muted text-body-sm mt-2 font-semibold">
              {t.rich("sendSuccessDesc", {
                name: recipient.name,
                b: (c) => <b className="text-foreground font-extrabold">{c}</b>,
              })}
            </p>
            <button
              type="button"
              onClick={() => router.push("/coligo-pay")}
              className="bg-primary-600 hover:bg-primary-700 rounded-card-lg text-title-sm mt-6 inline-flex h-12 w-full max-w-[320px] items-center justify-center font-extrabold text-white"
            >
              {t("qrDone")}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Avatar ────────────────────────────────────────────────────────────────
function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-black text-white",
        avatarGradient(name)
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initial(name)}
    </span>
  );
}

// ─── Étape recherche ─────────────────────────────────────────────────────────
function SearchStep({
  t,
  query,
  setQuery,
  busy,
  onSearch,
  recents,
  onPick,
  error,
}: {
  t: (k: string) => string;
  query: string;
  setQuery: (v: string) => void;
  busy: boolean;
  onSearch: () => void;
  recents: RecentRecipient[];
  onPick: (r: RecentRecipient) => void;
  error: string | null;
}) {
  return (
    <div className="space-y-5">
      <div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSearch();
          }}
          className="border-primary-400 focus-within:ring-primary-100 rounded-card-xl flex items-center gap-2.5 border bg-white px-3.5 py-3.5 focus-within:ring-2"
        >
          <Search className="text-primary-600 size-[18px] shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("sendSearchPlaceholder")}
            className="text-foreground w-full bg-transparent text-sm font-bold outline-none placeholder:font-medium"
          />
          {busy ? (
            <Loader2 className="text-primary-600 size-4 animate-spin" />
          ) : (
            query.trim().length >= 4 && (
              <button
                type="submit"
                className="bg-primary-600 grid size-8 shrink-0 place-items-center rounded-full text-white"
                aria-label={t("sendContinue")}
              >
                <ArrowRight className="size-4 rtl:-scale-x-100" />
              </button>
            )
          )}
        </form>
        <p className="text-muted text-caption-lg mt-2 px-1 font-medium">
          {t("sendSearchHint")}
        </p>
        {error && (
          <p className="text-danger-600 text-label-lg mt-2 px-1 font-semibold">
            {error}
          </p>
        )}
      </div>

      <div>
        <p className="text-muted text-caption px-1 pb-2 font-extrabold tracking-wide uppercase">
          {t("sendRecents")}
        </p>
        {recents.length === 0 ? (
          <p className="text-subtle text-body-sm px-1 font-medium">
            {t("sendNoRecents")}
          </p>
        ) : (
          <div className="divide-border rounded-sheet-lg divide-y overflow-hidden bg-white">
            {recents.map((r) => (
              <button
                key={r.handle}
                type="button"
                onClick={() => onPick(r)}
                className="hover:bg-surface-2 flex w-full items-center gap-3 px-4 py-3 text-start transition-colors"
              >
                <Avatar name={r.name} />
                <span className="min-w-0 flex-1">
                  <span className="text-foreground text-body-xl block truncate font-extrabold">
                    {r.name}
                  </span>
                  <span className="text-muted block truncate text-xs font-semibold">
                    {r.handle}
                  </span>
                </span>
                <span className="bg-primary-600 grid size-9 shrink-0 place-items-center rounded-full text-white">
                  <Send className="size-4" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Étape montant (clavier) ─────────────────────────────────────────────────
function AmountStep({
  t,
  recipient,
  amount,
  setAmount,
  note,
  setNote,
  balanceDa,
  onContinue,
  error,
}: {
  t: (k: string, v?: Record<string, string>) => string;
  recipient: Recipient;
  amount: string;
  setAmount: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  balanceDa: number;
  onContinue: () => void;
  error: string | null;
}) {
  const amountNum = Number(amount) || 0;
  const over = amountNum > balanceDa;

  function press(k: string) {
    if (k === "del") {
      setAmount(amount.slice(0, -1));
      return;
    }
    if (amount.length >= 7) return;
    if (amount === "" && k === "0") return; // pas de zéro en tête
    setAmount(amount + k);
  }

  return (
    <div className="flex flex-col items-center">
      <div className="flex flex-col items-center gap-2">
        <Avatar name={recipient.name} size={66} />
        <span className="text-muted text-xs font-bold">{t("sendTo")}</span>
        <span className="text-foreground text-lg font-black">
          {recipient.name}
        </span>
        <span className="text-muted text-xs font-semibold">
          {recipient.handle}
        </span>
      </div>

      <div className="mt-6 text-center">
        <p className="text-foreground text-[46px] leading-none font-black tracking-tight tabular-nums">
          {amountNum.toLocaleString("fr-DZ")}
          <span className="text-muted ms-1.5 text-2xl font-extrabold">DA</span>
        </p>
        <p
          className={cn(
            "text-label-lg mt-2 font-bold",
            over ? "text-danger-600" : "text-muted"
          )}
        >
          {t("sendAvailable", { amount: formatDA(balanceDa) })}
        </p>
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 140))}
        placeholder={t("sendNotePlaceholder")}
        className="border-border rounded-card-lg mt-5 w-full max-w-[320px] border bg-white px-4 py-3 text-center text-sm font-semibold outline-none"
      />

      <div className="mt-5 grid w-full max-w-[320px] grid-cols-3 gap-1.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
          <Key key={k} onClick={() => press(k)}>
            {k}
          </Key>
        ))}
        <Key onClick={() => setAmount("")}>
          <span className="text-muted text-base font-extrabold">C</span>
        </Key>
        <Key onClick={() => press("0")}>0</Key>
        <Key onClick={() => press("del")}>
          <Delete className="text-muted size-6" />
        </Key>
      </div>

      {error && (
        <p className="text-danger-600 text-label-lg mt-4 text-center font-semibold">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={amountNum <= 0 || over}
        onClick={onContinue}
        className="bg-primary-600 hover:bg-primary-700 rounded-card-xl text-title-sm mt-6 inline-flex h-[52px] w-full max-w-[320px] items-center justify-center gap-2 font-extrabold text-white disabled:opacity-40"
      >
        {t("sendContinue")}
        <ArrowRight className="size-4 rtl:-scale-x-100" />
      </button>
    </div>
  );
}

function Key({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="active:bg-surface-3 text-foreground rounded-card-lg grid h-14 place-items-center text-[23px] font-extrabold tabular-nums transition-colors"
    >
      {children}
    </button>
  );
}

// ─── Étape confirmation (+ PIN) ──────────────────────────────────────────────
function ConfirmStep({
  t,
  senderName,
  recipient,
  amountNum,
  note,
  balanceDa,
  locked,
  hasPin,
  onPinCreated,
  onForgot,
  pin,
  setPin,
  busy,
  onSend,
  error,
}: {
  t: (k: string, v?: Record<string, string>) => string;
  senderName: string;
  recipient: Recipient;
  amountNum: number;
  note: string;
  balanceDa: number;
  locked: boolean;
  hasPin: boolean;
  onPinCreated: () => void;
  /** Ouvre la récupération du PIN par email (« Code oublié ? »). */
  onForgot: () => void;
  pin: string;
  setPin: (v: string) => void;
  busy: boolean;
  onSend: () => void;
  error: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-panel bg-white p-6 text-center">
        <div className="mb-4 flex items-center justify-center gap-4">
          <div className="flex flex-col items-center gap-1.5">
            <Avatar name={senderName} size={54} />
            <span className="text-muted text-caption-lg font-bold">
              {t("sendYou")}
            </span>
          </div>
          <ArrowRight className="text-primary-600 size-6 rtl:-scale-x-100" />
          <div className="flex flex-col items-center gap-1.5">
            <Avatar name={recipient.name} size={54} />
            <span className="text-muted text-caption-lg font-bold">
              {recipient.name.split(" ")[0]}
            </span>
          </div>
        </div>
        <p className="text-muted text-label-lg font-bold">{t("sendYouSend")}</p>
        <p className="text-foreground mt-1 text-[38px] leading-none font-black tracking-tight tabular-nums">
          {formatDA(amountNum)}
        </p>
        {note.trim() && (
          <p className="bg-surface-2 text-foreground text-body-sm mt-4 rounded-md px-3.5 py-2.5 font-semibold">
            « {note.trim()} »
          </p>
        )}
      </div>

      <div className="divide-border rounded-sheet-lg divide-y bg-white px-4">
        <Row
          k={t("sendRecipient")}
          v={`${recipient.name} · ${recipient.handle}`}
        />
        <Row k={t("sendAmount")} v={formatDA(amountNum)} />
        <Row k={t("sendFees")} v={t("sendFree")} green />
        <Row
          k={t("sendBalanceAfter")}
          v={formatDA(Math.max(0, balanceDa - amountNum))}
        />
      </div>

      <div className="text-muted text-caption-lg flex items-start gap-2 px-1 font-medium">
        <ShieldCheck className="text-primary-600 mt-0.5 size-4 shrink-0" />
        <span>{t("sendSecurityNote")}</span>
      </div>

      {/* PIN obligatoire */}
      {locked ? (
        <div className="border-danger-200 bg-danger-50 text-danger-700 rounded-card-lg border px-4 py-3 text-sm font-semibold">
          <span className="flex items-center gap-2">
            <Lock className="size-4 shrink-0" />
            {t("qrErrPinLocked")}
          </span>
          {/* Sortie de secours : le reset par email lève aussi le verrouillage. */}
          <button
            type="button"
            onClick={onForgot}
            className="text-primary-600 text-label-lg mt-2 font-bold underline"
          >
            {t("pinForgot")}
          </button>
        </div>
      ) : !hasPin ? (
        <InlineCreatePin t={t} onCreated={onPinCreated} />
      ) : (
        <div className="bg-surface rounded-lg p-4">
          <p className="text-muted text-body-sm mb-2 text-center font-bold">
            {t("sendEnterPin")}
          </p>
          <input
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) =>
              setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            placeholder="••••"
            className="border-border bg-surface-2 text-foreground placeholder:text-subtle focus:border-primary-400 rounded-card-lg w-full border py-3.5 text-center text-2xl font-black tracking-[0.5em] tabular-nums outline-none"
          />
          {error && (
            <p className="text-danger-600 text-label-lg mt-2 text-center font-semibold">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={busy || pin.length !== 4 || locked}
            onClick={onSend}
            className="bg-primary-600 hover:bg-primary-700 rounded-card-xl text-title-sm mt-4 inline-flex h-[52px] w-full items-center justify-center gap-2 font-extrabold text-white disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <>
                <Check className="size-5" />
                {t("sendConfirmCta", { amount: formatDA(amountNum) })}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onForgot}
            className="text-primary-600 text-label-lg mt-3 block w-full text-center font-bold"
          >
            {t("pinForgot")}
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, green }: { k: string; v: string; green?: boolean }) {
  return (
    <div className="text-body flex items-center justify-between gap-3 py-3 font-bold">
      <span className="text-muted">{k}</span>
      <span className={green ? "text-success-700" : "text-foreground"}>
        {v}
      </span>
    </div>
  );
}

function InlineCreatePin({
  t,
  onCreated,
}: {
  t: (k: string) => string;
  onCreated: () => void;
}) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  // Erreur EN LIGNE dans la carte de création du PIN (pas de toast).
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!/^\d{4}$/.test(a)) {
      setErr(t("qrErrPinNotSet"));
      return;
    }
    if (a !== b) {
      setErr(t("qrPinMismatch"));
      return;
    }
    setBusy(true);
    const res = await setWalletPin(a);
    setBusy(false);
    if (!res.ok) {
      if (res.error === "pin_exists") {
        // Un PIN existe déjà (état local périmé) : le serveur a refusé
        // d'écraser (mig 0360) → on bascule sur la saisie du PIN existant.
        onCreated();
        return;
      }
      setErr(t("qrErrPinNotSet"));
      return;
    }
    // Succès : onCreated() bascule vers la saisie du PIN (retour visuel).
    onCreated();
  }

  return (
    <div className="bg-surface rounded-lg p-4">
      <p className="text-foreground flex items-center gap-2 text-sm font-extrabold">
        <Lock className="text-primary-600 size-4" />
        {t("qrCreatePinTitle")}
      </p>
      <p className="text-muted text-label mt-1 font-medium">
        {t("qrCreatePinDesc")}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <input
          inputMode="numeric"
          value={a}
          onChange={(e) => {
            setA(e.target.value.replace(/\D/g, "").slice(0, 4));
            setErr(null);
          }}
          placeholder={t("qrPinLabel")}
          className="border-border bg-surface-2 text-foreground placeholder:text-subtle focus:border-primary-400 rounded-md border py-3 text-center text-lg font-black tracking-[0.4em] tabular-nums outline-none"
        />
        <input
          inputMode="numeric"
          value={b}
          onChange={(e) => {
            setB(e.target.value.replace(/\D/g, "").slice(0, 4));
            setErr(null);
          }}
          placeholder={t("qrPinConfirmLabel")}
          className="border-border bg-surface-2 text-foreground placeholder:text-subtle focus:border-primary-400 rounded-md border py-3 text-center text-lg font-black tracking-[0.4em] tabular-nums outline-none"
        />
      </div>
      {err && (
        <p className="text-danger-600 text-label mt-2 font-semibold">{err}</p>
      )}
      <button
        type="button"
        disabled={busy || a.length !== 4 || b.length !== 4}
        onClick={save}
        className="bg-primary-600 hover:bg-primary-700 rounded-card mt-3 inline-flex h-11 w-full items-center justify-center gap-2 text-sm font-extrabold text-white disabled:opacity-40"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          t("qrCreatePinCta")
        )}
      </button>
    </div>
  );
}
