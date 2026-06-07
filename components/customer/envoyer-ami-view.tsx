"use client";

import { useState } from "react";
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
import { toast } from "@/components/ui/toast";
import { cn, formatDA } from "@/lib/utils";
import {
  executeTransfer,
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
  const [query, setQuery] = useState("");
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState("");
  const [hasPin, setHasPin] = useState(initialHasPin);
  const [opId, setOpId] = useState("");

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
    setBusy(true);
    const res = await searchRecipient(q);
    setBusy(false);
    if (!res.ok) {
      toast.error(errMsg(res.error));
      return;
    }
    pick({ handle: res.handle, name: res.name });
  }

  function goConfirm() {
    if (amountNum <= 0) {
      toast.error(t("invalidAmount"));
      return;
    }
    if (amountNum > balanceDa) {
      toast.error(t("qrErrInsufficient"));
      return;
    }
    setPin("");
    setStep("confirm");
  }

  async function doSend() {
    if (!recipient || pin.length !== 4) return;
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
      toast.error(errMsg(res.error));
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
            if (step === "search") router.push("/coligo-pay");
            else if (step === "amount") setStep("search");
            else if (step === "confirm") setStep("amount");
            else router.push("/coligo-pay");
          }}
          className="bg-surface-2 grid size-9 place-items-center rounded-full transition-transform active:scale-90"
        >
          <ChevronLeft className="size-[18px] rtl:-scale-x-100" />
        </button>
        <h1 className="text-[19px] font-black tracking-tight">
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
          />
        )}

        {step === "confirm" && recipient && (
          <ConfirmStep
            t={t}
            senderName={senderName}
            recipient={recipient}
            amountNum={amountNum}
            note={note}
            balanceDa={balanceDa}
            locked={locked}
            hasPin={hasPin}
            onPinCreated={() => setHasPin(true)}
            pin={pin}
            setPin={setPin}
            busy={busy}
            onSend={doSend}
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
            <p className="text-muted mt-2 text-[13px] font-semibold">
              {t.rich("sendSuccessDesc", {
                name: recipient.name,
                b: (c) => <b className="text-foreground font-extrabold">{c}</b>,
              })}
            </p>
            <button
              type="button"
              onClick={() => router.push("/coligo-pay")}
              className="bg-primary-600 hover:bg-primary-700 mt-6 inline-flex h-12 w-full max-w-[320px] items-center justify-center rounded-[14px] text-[15px] font-extrabold text-white"
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
}: {
  t: (k: string) => string;
  query: string;
  setQuery: (v: string) => void;
  busy: boolean;
  onSearch: () => void;
  recents: RecentRecipient[];
  onPick: (r: RecentRecipient) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSearch();
          }}
          className="border-primary-400 focus-within:ring-primary-100 flex items-center gap-2.5 rounded-[15px] border bg-white px-3.5 py-3.5 shadow-[0_4px_14px_-8px_rgba(91,91,230,.45)] focus-within:ring-2"
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
        <p className="text-muted mt-2 px-1 text-[11.5px] font-medium">
          {t("sendSearchHint")}
        </p>
      </div>

      <div>
        <p className="text-muted px-1 pb-2 text-[11px] font-extrabold tracking-wide uppercase">
          {t("sendRecents")}
        </p>
        {recents.length === 0 ? (
          <p className="text-subtle px-1 text-[13px] font-medium">
            {t("sendNoRecents")}
          </p>
        ) : (
          <div className="divide-border divide-y overflow-hidden rounded-[18px] bg-white shadow-[0_8px_20px_-16px_rgba(40,35,90,.2)]">
            {recents.map((r) => (
              <button
                key={r.handle}
                type="button"
                onClick={() => onPick(r)}
                className="hover:bg-surface-2 flex w-full items-center gap-3 px-4 py-3 text-start transition-colors"
              >
                <Avatar name={r.name} />
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate text-[14.5px] font-extrabold">
                    {r.name}
                  </span>
                  <span className="text-muted block truncate text-xs font-semibold">
                    {r.handle}
                  </span>
                </span>
                <span className="bg-primary-600 grid size-9 shrink-0 place-items-center rounded-full text-white shadow-[0_4px_10px_-3px_rgba(91,91,230,.45)]">
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
}: {
  t: (k: string, v?: Record<string, string>) => string;
  recipient: Recipient;
  amount: string;
  setAmount: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  balanceDa: number;
  onContinue: () => void;
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
            "mt-2 text-[12.5px] font-bold",
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
        className="border-border mt-5 w-full max-w-[320px] rounded-[14px] border bg-white px-4 py-3 text-center text-sm font-semibold outline-none"
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

      <button
        type="button"
        disabled={amountNum <= 0 || over}
        onClick={onContinue}
        className="bg-primary-600 hover:bg-primary-700 mt-6 inline-flex h-[52px] w-full max-w-[320px] items-center justify-center gap-2 rounded-[15px] text-[15px] font-extrabold text-white shadow-[0_10px_24px_-6px_rgba(91,91,230,.45)] disabled:opacity-40"
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
      className="active:bg-surface-3 text-foreground grid h-14 place-items-center rounded-[14px] text-[23px] font-extrabold tabular-nums transition-colors"
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
  pin,
  setPin,
  busy,
  onSend,
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
  pin: string;
  setPin: (v: string) => void;
  busy: boolean;
  onSend: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-[24px] bg-white p-6 text-center shadow-[0_14px_34px_-16px_rgba(40,35,90,.26)]">
        <div className="mb-4 flex items-center justify-center gap-4">
          <div className="flex flex-col items-center gap-1.5">
            <Avatar name={senderName} size={54} />
            <span className="text-muted text-[11.5px] font-bold">
              {t("sendYou")}
            </span>
          </div>
          <ArrowRight className="text-primary-600 size-6 rtl:-scale-x-100" />
          <div className="flex flex-col items-center gap-1.5">
            <Avatar name={recipient.name} size={54} />
            <span className="text-muted text-[11.5px] font-bold">
              {recipient.name.split(" ")[0]}
            </span>
          </div>
        </div>
        <p className="text-muted text-[12.5px] font-bold">{t("sendYouSend")}</p>
        <p className="text-foreground mt-1 text-[38px] leading-none font-black tracking-tight tabular-nums">
          {formatDA(amountNum)}
        </p>
        {note.trim() && (
          <p className="bg-surface-2 text-foreground mt-4 rounded-[12px] px-3.5 py-2.5 text-[13px] font-semibold">
            « {note.trim()} »
          </p>
        )}
      </div>

      <div className="divide-border divide-y rounded-[18px] bg-white px-4 shadow-[0_8px_20px_-16px_rgba(40,35,90,.2)]">
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

      <div className="text-muted flex items-start gap-2 px-1 text-[11.5px] font-medium">
        <ShieldCheck className="text-primary-600 mt-0.5 size-4 shrink-0" />
        <span>{t("sendSecurityNote")}</span>
      </div>

      {/* PIN obligatoire */}
      {locked ? (
        <div className="border-danger-200 bg-danger-50 text-danger-700 flex items-center gap-2 rounded-[14px] border px-4 py-3 text-sm font-semibold">
          <Lock className="size-4 shrink-0" />
          {t("qrErrPinLocked")}
        </div>
      ) : !hasPin ? (
        <InlineCreatePin t={t} onCreated={onPinCreated} />
      ) : (
        <div className="rounded-[16px] bg-white p-4 shadow-[0_8px_20px_-16px_rgba(40,35,90,.2)]">
          <p className="text-muted mb-2 text-center text-[13px] font-bold">
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
            className="border-border bg-surface-2 focus:border-primary-400 w-full rounded-[14px] border py-3.5 text-center text-2xl font-black tracking-[0.5em] tabular-nums outline-none"
          />
          <button
            type="button"
            disabled={busy || pin.length !== 4 || locked}
            onClick={onSend}
            className="bg-primary-600 hover:bg-primary-700 mt-4 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[15px] text-[15px] font-extrabold text-white shadow-[0_10px_24px_-6px_rgba(91,91,230,.45)] disabled:opacity-40"
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
        </div>
      )}
    </div>
  );
}

function Row({ k, v, green }: { k: string; v: string; green?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 text-[13.5px] font-bold">
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

  async function save() {
    if (!/^\d{4}$/.test(a)) {
      toast.error(t("qrErrPinNotSet"));
      return;
    }
    if (a !== b) {
      toast.error(t("qrPinMismatch"));
      return;
    }
    setBusy(true);
    const res = await setWalletPin(a);
    setBusy(false);
    if (!res.ok) {
      toast.error(t("qrErrPinNotSet"));
      return;
    }
    toast.success(t("qrPinSaved"));
    onCreated();
  }

  return (
    <div className="rounded-[16px] bg-white p-4 shadow-[0_8px_20px_-16px_rgba(40,35,90,.2)]">
      <p className="text-foreground flex items-center gap-2 text-sm font-extrabold">
        <Lock className="text-primary-600 size-4" />
        {t("qrCreatePinTitle")}
      </p>
      <p className="text-muted mt-1 text-[12px] font-medium">
        {t("qrCreatePinDesc")}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <input
          inputMode="numeric"
          value={a}
          onChange={(e) => setA(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder={t("qrPinLabel")}
          className="border-border bg-surface-2 focus:border-primary-400 rounded-[12px] border py-3 text-center text-lg font-black tracking-[0.4em] tabular-nums outline-none"
        />
        <input
          inputMode="numeric"
          value={b}
          onChange={(e) => setB(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder={t("qrPinConfirmLabel")}
          className="border-border bg-surface-2 focus:border-primary-400 rounded-[12px] border py-3 text-center text-lg font-black tracking-[0.4em] tabular-nums outline-none"
        />
      </div>
      <button
        type="button"
        disabled={busy || a.length !== 4 || b.length !== 4}
        onClick={save}
        className="bg-primary-600 hover:bg-primary-700 mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[13px] text-sm font-extrabold text-white disabled:opacity-40"
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
