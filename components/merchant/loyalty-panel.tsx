"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  Clock,
  CreditCard,
  Gift,
  Loader2,
  Minus,
  Plus,
  Sparkles,
  WifiOff,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatDA } from "@/lib/utils";
import { enqueueOrExecute } from "@/lib/offline/queue";
import { loyaltyErrorMessage } from "@/lib/merchant/loyalty-messages";
import {
  redeemLoyalty,
  resolveLoyaltyScan,
  type LoyaltyCreditData,
  type LoyaltyFiche,
  type LoyaltyQueueResult,
  type LoyaltyRedeemResult,
  type LoyaltySummary,
} from "@/app/(merchant)/orders/loyalty-actions";

/* ------------------------- signaux sensoriels ----------------------------- */
/** Vibrations DISTINCTES du flux commande (spec 2.5) : double impulsion
 *  fidélité vs impulsion simple retrait. Silencieux si non supporté. */
export function loyaltyBuzz(kind: "detect" | "success" | "error") {
  if (typeof navigator === "undefined") return;
  try {
    navigator.vibrate?.(
      kind === "detect"
        ? [30, 40, 30]
        : kind === "success"
          ? [30, 40, 30, 40, 90]
          : [90, 50, 90]
    );
  } catch {
    /* ignored */
  }
}

/** Carillon fidélité (deux notes montantes, Web Audio — aucun asset, aucun
 *  réseau). Distinct du flux commande, qui reste silencieux sur cet écran. */
function loyaltyChime() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const note = (freq: number, at: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + at + 0.28
      );
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.3);
    };
    note(784, 0); // G5
    note(1175, 0.14); // D6
    setTimeout(() => void ctx.close().catch(() => undefined), 800);
  } catch {
    /* ignored — la vibration reste le signal principal */
  }
}

/* ------------------------------- helpers ---------------------------------- */

function dayFr(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1)
    .toString()
    .padStart(2, "0")}`;
}

/** Bandeau « Bon de X DA gagné — actif demain » (exigence propriétaire :
 *  un palier différé par le plafond 24 h n'est JAMAIS silencieux). */
function DeferredBanner({ amountDa }: { amountDa: number }) {
  if (!amountDa) return null;
  return (
    <div className="border-warning-200 bg-warning-50 flex items-center gap-2.5 rounded-md border p-3">
      <Gift className="text-warning-600 size-5 shrink-0" />
      <p className="text-warning-800 text-sm font-semibold">
        Bon de {formatDA(amountDa)} gagné — actif demain
        <span className="text-warning-700 block text-xs font-normal">
          Plafond fidélité du jour atteint : le bon se posera au prochain scan.
        </span>
      </p>
    </div>
  );
}

/* --------------------------- bloc réduction -------------------------------- */

type RedeemExec = (
  clientOperationId: string,
  voucherId: string | null,
  amountDa: number | null
) => Promise<LoyaltyRedeemResult>;

/**
 * Choix + confirmation d'une réduction (bon OU cashback). RÈGLE PROPRIÉTAIRE :
 * connexion OBLIGATOIRE, échec réseau = message clair, JAMAIS de retry
 * automatique — seul un « Réessayer » MANUEL (même client_operation_id,
 * idempotent) est proposé. Partagé entre le panneau scan et le cas combiné
 * commande (2.4).
 */
export function LoyaltyRedeemBlock({
  summary,
  execute,
  onDone,
}: {
  summary: LoyaltySummary;
  execute: RedeemExec;
  onDone: (res: LoyaltyRedeemResult) => void;
}) {
  const [choice, setChoice] = useState<
    | { voucherId: string; amountDa: number }
    | { voucherId: null; amountDa: number }
    | null
  >(null);
  const [cashInput, setCashInput] = useState(String(summary.available_da));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [netFail, setNetFail] = useState(false);
  // Un id d'opération STABLE par confirmation : le retry manuel rejoue la
  // MÊME opération (le serveur répond already:true si elle avait abouti).
  const opRef = useRef<string | null>(null);

  function pick(next: NonNullable<typeof choice>) {
    opRef.current = crypto.randomUUID();
    setError(null);
    setNetFail(false);
    setChoice(next);
  }

  async function confirm() {
    if (!choice || !opRef.current) return;
    setError(null);
    setNetFail(false);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setNetFail(true);
      setError(
        "Connexion requise pour appliquer une réduction. La déduction n'a PAS été faite."
      );
      loyaltyBuzz("error");
      return;
    }
    setPending(true);
    try {
      const res = await execute(
        opRef.current,
        choice.voucherId,
        choice.voucherId ? null : choice.amountDa
      );
      if (!res.ok) {
        setError(
          res.code === "insufficient" && typeof res.available_da === "number"
            ? `Solde insuffisant — disponible : ${formatDA(res.available_da)}.`
            : loyaltyErrorMessage(res.code)
        );
        loyaltyBuzz("error");
        // Erreur métier définitive : on repart du choix (nouvel op id au
        // prochain choix).
        setChoice(null);
        return;
      }
      loyaltyBuzz("success");
      loyaltyChime();
      onDone(res);
    } catch {
      // ÉCHEC RÉSEAU : rien n'est certain côté serveur → message explicite,
      // retry MANUEL uniquement, MÊME opération.
      setNetFail(true);
      setError(
        "Échec réseau — la déduction n'a PAS été confirmée. Vérifiez la connexion puis appuyez sur Réessayer."
      );
      loyaltyBuzz("error");
    } finally {
      setPending(false);
    }
  }

  const cashAmount = Math.max(0, Math.round(Number(cashInput) || 0));

  if (choice) {
    return (
      <div className="space-y-3">
        <p className="text-center text-lg font-bold">
          Déduire {formatDA(choice.amountDa)} de l&apos;addition ?
        </p>
        <p className="text-muted text-center text-sm">
          {choice.voucherId
            ? "Le bon sera consommé définitivement."
            : "Le cashback du client sera débité."}
        </p>
        {error && (
          <div className="border-danger-200 bg-danger-50 flex items-start gap-2 rounded-md border p-3">
            <WifiOff
              className={cn(
                "text-danger-600 mt-0.5 size-4 shrink-0",
                !netFail && "hidden"
              )}
            />
            <p className="text-danger-700 text-sm font-medium">{error}</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="lg"
            disabled={pending}
            onClick={() => {
              setChoice(null);
              setError(null);
            }}
          >
            Annuler
          </Button>
          <Button
            size="lg"
            disabled={pending}
            onClick={confirm}
            className="bg-success-600 hover:bg-success-700"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Minus className="size-4" />
            )}
            {netFail ? "Réessayer" : "Confirmer"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {summary.vouchers.length > 0 && (
        <div className="space-y-2">
          {summary.vouchers.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => pick({ voucherId: v.id, amountDa: v.amount_da })}
              className="border-success-200 bg-success-50 hover:bg-success-100 flex w-full items-center justify-between rounded-md border p-4 text-left transition-colors active:scale-[0.99]"
            >
              <span className="flex items-center gap-2.5">
                <Gift className="text-success-600 size-5" />
                <span className="text-success-800 text-lg font-bold">
                  Bon de {formatDA(v.amount_da)}
                </span>
              </span>
              <span className="text-success-700 text-xs">
                exp. {dayFr(v.expires_at)}
              </span>
            </button>
          ))}
        </div>
      )}
      {summary.available_da > 0 && (
        <div className="border-border bg-surface space-y-2 rounded-md border p-3">
          <p className="text-sm font-semibold">
            Cashback — disponible : {formatDA(summary.available_da)}
          </p>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              value={cashInput}
              onChange={(e) => setCashInput(e.target.value)}
              aria-label="Montant à déduire"
              className="border-border-strong focus:border-primary-400 focus:ring-primary-400/40 h-12 w-full rounded-md border text-center text-xl font-bold tabular-nums focus:ring-2 focus:outline-none"
            />
            <Button
              size="lg"
              disabled={cashAmount <= 0 || cashAmount > summary.available_da}
              onClick={() => pick({ voucherId: null, amountDa: cashAmount })}
            >
              Déduire
            </Button>
          </div>
        </div>
      )}
      {summary.vouchers.length === 0 && summary.available_da <= 0 && (
        <p className="text-muted text-center text-sm">
          Aucune réduction disponible pour l&apos;instant.
        </p>
      )}
    </div>
  );
}

/* ------------------------------ le panneau --------------------------------- */

type View =
  | "loading"
  | "offline"
  | "fiche"
  | "credit"
  | "creditDone"
  | "redeem"
  | "redeemDone"
  | "rejected";

/**
 * Fiche fidélité du porteur scanné, chez CE commerçant (SPEC 2.3) :
 * éligibilité lisible en 2 s, sinon progression « il lui manque X DA » ;
 * deux actions — créditer l'achat (hors-ligne OK, file idempotente) ou
 * appliquer une réduction (connexion exigée). Très gros, une action à la fois.
 */
export function LoyaltyPanel({
  identifier,
  onClose,
}: {
  identifier: string;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>("loading");
  const [fiche, setFiche] = useState<LoyaltyFiche | null>(null);
  const [rejectMsg, setRejectMsg] = useState<string>("");
  const [amountInput, setAmountInput] = useState("");
  const [creditPending, setCreditPending] = useState(false);
  const [creditError, setCreditError] = useState<string | null>(null);
  const [creditDone, setCreditDone] = useState<{
    queued: boolean;
    data?: LoyaltyCreditData;
  } | null>(null);
  const [redeemDone, setRedeemDone] = useState<LoyaltyRedeemResult | null>(
    null
  );

  const load = useCallback(async () => {
    setView("loading");
    try {
      const res = await resolveLoyaltyScan(identifier);
      if (!res.ok) {
        setRejectMsg(loyaltyErrorMessage(res.error));
        setView("rejected");
        loyaltyBuzz("error");
        return;
      }
      setFiche(res);
      setView("fiche");
    } catch {
      setView("offline");
    }
  }, [identifier]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = fiche?.summary ?? {
    balance_da: 0,
    available_da: 0,
    vouchers: [],
    progress: null,
  };
  const hasReduction = summary.vouchers.length > 0 || summary.available_da > 0;
  const reductionTotal =
    summary.available_da +
    summary.vouchers.reduce((s, v) => s + v.amount_da, 0);

  function applySummary(next?: LoyaltySummary) {
    if (next && fiche) setFiche({ ...fiche, summary: next });
  }

  async function submitCredit() {
    const amount = Math.round(Number(amountInput) || 0);
    if (amount <= 0) {
      setCreditError("Saisissez le montant de l'achat.");
      return;
    }
    setCreditError(null);
    setCreditPending(true);
    try {
      const outcome = await enqueueOrExecute({
        type: "loyalty_credit",
        identifier,
        purchaseDa: amount,
      });
      if (outcome.mode === "queued") {
        loyaltyBuzz("success");
        setCreditDone({ queued: true });
        setView("creditDone");
        return;
      }
      const res = outcome.result as LoyaltyQueueResult;
      if (res.error || !res.data) {
        setCreditError(res.error ?? "Crédit impossible. Réessayez.");
        loyaltyBuzz("error");
        return;
      }
      applySummary(res.data.summary);
      setCreditDone({ queued: false, data: res.data });
      setView("creditDone");
      loyaltyBuzz("success");
      loyaltyChime();
    } catch {
      setCreditError(
        "Impossible d'enregistrer le crédit — vérifiez la connexion et réessayez."
      );
      loyaltyBuzz("error");
    } finally {
      setCreditPending(false);
    }
  }

  /* ------------------------------ rendus ------------------------------- */

  const shell = (children: React.ReactNode) => (
    <div className="border-primary-200 bg-surface rounded-lg border p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="bg-primary-50 text-primary-700 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold tracking-wide uppercase">
          <CreditCard className="size-3.5" />
          Fidélité
        </span>
        {fiche?.label && (
          <span className="text-foreground truncate text-lg font-bold">
            {fiche.label}
          </span>
        )}
      </div>
      {children}
    </div>
  );

  if (view === "loading") {
    return shell(
      <div className="flex flex-col items-center gap-3 py-8">
        <Loader2 className="text-primary-600 size-8 animate-spin" />
        <p className="text-muted text-sm">Lecture de la fiche fidélité…</p>
      </div>
    );
  }

  if (view === "offline") {
    return shell(
      <div className="space-y-4 py-2 text-center">
        <WifiOff className="text-muted mx-auto size-10" />
        <p className="text-foreground font-semibold">
          Connexion nécessaire pour lire la fiche fidélité.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="lg" onClick={onClose}>
            Annuler
          </Button>
          <Button size="lg" onClick={() => void load()}>
            Réessayer
          </Button>
        </div>
      </div>
    );
  }

  if (view === "rejected") {
    return shell(
      <div className="space-y-4 py-2 text-center">
        <XCircle className="text-danger-600 mx-auto size-10" />
        <p className="text-foreground text-lg font-semibold">{rejectMsg}</p>
        <Button size="lg" className="w-full" onClick={onClose}>
          Scanner suivant
        </Button>
      </div>
    );
  }

  if (view === "credit") {
    const rate = Number(fiche?.program?.earn_rate_pct ?? 0);
    const amount = Math.round(Number(amountInput) || 0);
    return shell(
      <div className="space-y-4">
        <p className="text-center text-sm font-semibold">
          Montant de l&apos;achat du jour (DA)
        </p>
        <input
          autoFocus
          inputMode="numeric"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          placeholder="0"
          aria-label="Montant de l'achat (DA)"
          className="border-border-strong focus:border-primary-400 focus:ring-primary-400/40 h-16 w-full rounded-md border text-center text-4xl font-bold tabular-nums focus:ring-2 focus:outline-none"
        />
        {amount > 0 && rate > 0 && (
          <p className="text-success-700 text-center text-sm font-semibold">
            ≈ +{formatDA(Math.round((amount * rate) / 100))} de cashback
          </p>
        )}
        {creditError && (
          <p className="text-danger-600 text-center text-sm font-medium">
            {creditError}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="lg"
            disabled={creditPending}
            onClick={() => setView("fiche")}
          >
            <ArrowLeft className="size-4 rtl:rotate-180" />
            Retour
          </Button>
          <Button
            size="lg"
            disabled={creditPending || amount <= 0}
            onClick={() => void submitCredit()}
          >
            {creditPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Créditer
          </Button>
        </div>
      </div>
    );
  }

  if (view === "creditDone" && creditDone) {
    if (creditDone.queued) {
      return shell(
        <div className="space-y-4 text-center">
          <Clock className="text-warning-600 mx-auto size-12" />
          <p className="text-warning-800 text-lg font-semibold">
            Crédit enregistré — en attente de réseau
          </p>
          <p className="text-muted text-sm">
            Il sera appliqué automatiquement au retour de la connexion. Les
            réductions, elles, nécessitent d&apos;être en ligne.
          </p>
          <Button size="lg" className="w-full" onClick={onClose}>
            Scanner suivant
          </Button>
        </div>
      );
    }
    const d = creditDone.data;
    const progress = d?.summary?.progress;
    return shell(
      <div className="space-y-3 text-center">
        <CheckCircle2 className="text-success-600 mx-auto size-12" />
        <p className="text-success-700 text-4xl font-extrabold tabular-nums">
          +{formatDA(d?.earned_da ?? 0)}
        </p>
        <p className="text-muted text-sm">
          crédités{d?.activated ? " · carte activée" : ""}
          {d?.capped ? " · plafond du jour atteint, crédit ajusté" : ""}
        </p>
        {(d?.vouchers_granted ?? []).map((v) => (
          <div
            key={v.id}
            className="border-success-200 bg-success-50 flex items-center justify-center gap-2 rounded-md border p-3"
          >
            <Sparkles className="text-success-600 size-5" />
            <p className="text-success-800 text-base font-bold">
              Bon de {formatDA(v.amount_da)} débloqué !
            </p>
          </div>
        ))}
        <DeferredBanner amountDa={d?.voucher_deferred_da ?? 0} />
        {progress && progress.remaining_da > 0 && (
          <p className="text-primary-800 text-sm font-medium">
            Encore {formatDA(progress.remaining_da)} d&apos;achats pour
            débloquer {formatDA(progress.reward_da)} — dites-le au client.
          </p>
        )}
        <div className="grid gap-2">
          {hasReduction && (
            <Button
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => setView("redeem")}
            >
              <Minus className="size-4" />
              Appliquer une réduction
            </Button>
          )}
          <Button size="lg" className="w-full" onClick={onClose}>
            Scanner suivant
          </Button>
        </div>
      </div>
    );
  }

  if (view === "redeem") {
    return shell(
      <div className="space-y-4">
        <p className="text-center text-sm font-semibold">
          Choisir la réduction à appliquer
        </p>
        <LoyaltyRedeemBlock
          summary={summary}
          execute={(op, voucherId, amountDa) =>
            redeemLoyalty(identifier, op, voucherId, amountDa)
          }
          onDone={(res) => {
            applySummary(res.summary);
            setRedeemDone(res);
            setView("redeemDone");
          }}
        />
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          onClick={() => setView("fiche")}
        >
          <ArrowLeft className="size-4 rtl:rotate-180" />
          Retour
        </Button>
      </div>
    );
  }

  if (view === "redeemDone" && redeemDone) {
    return shell(
      <div className="space-y-4 text-center">
        <CheckCircle2 className="text-success-600 mx-auto size-12" />
        <p className="text-success-700 text-4xl font-extrabold tabular-nums">
          −{formatDA(redeemDone.deducted_da ?? 0)}
        </p>
        <p className="text-foreground text-base font-semibold">
          À déduire de l&apos;addition du client.
        </p>
        <p className="text-muted text-sm">
          Reste disponible : {formatDA(redeemDone.summary?.available_da ?? 0)}
          {(redeemDone.summary?.vouchers.length ?? 0) > 0 &&
            ` + ${redeemDone.summary?.vouchers.length} bon(s)`}
        </p>
        <Button size="lg" className="w-full" onClick={onClose}>
          Scanner suivant
        </Button>
      </div>
    );
  }

  /* --------------------------- vue FICHE (défaut) ----------------------- */
  const progress = summary.progress;
  const pct =
    progress && progress.threshold_da > 0
      ? Math.min(
          100,
          Math.round((progress.spent_da / progress.threshold_da) * 100)
        )
      : 0;

  return shell(
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {fiche?.linked && (
          <span className="bg-primary-50 text-primary-700 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold">
            <BadgeCheck className="size-3.5" />
            Compte lié
          </span>
        )}
        {fiche?.will_activate && (
          <span className="bg-warning-50 text-warning-700 rounded-full px-2.5 py-1 text-xs font-semibold">
            Nouvelle carte — s&apos;activera au 1ᵉʳ crédit
          </span>
        )}
      </div>

      <DeferredBanner amountDa={fiche?.voucher_deferred_da ?? 0} />

      {/* ÉLIGIBILITÉ EN 2 SECONDES — en très gros (lisible à 1 m). */}
      {hasReduction ? (
        <div className="border-success-200 bg-success-50 rounded-md border p-4 text-center">
          <p className="text-success-700 text-xs font-bold tracking-wide uppercase">
            Peut déduire maintenant
          </p>
          <p className="text-success-700 mt-1 text-4xl font-extrabold tabular-nums">
            {formatDA(reductionTotal)}
          </p>
          <div className="text-success-800 mt-2 space-y-0.5 text-sm font-medium">
            {summary.vouchers.map((v) => (
              <p key={v.id}>
                Bon de {formatDA(v.amount_da)} · exp. {dayFr(v.expires_at)}
              </p>
            ))}
            {summary.available_da > 0 && (
              <p>Cashback : {formatDA(summary.available_da)}</p>
            )}
          </div>
        </div>
      ) : progress ? (
        <div className="border-border bg-surface-2 rounded-md border p-4 text-center">
          <p className="text-foreground text-xl leading-snug font-bold">
            Il lui manque {formatDA(progress.remaining_da)}
            <span className="text-muted block text-sm font-medium">
              pour débloquer un bon de {formatDA(progress.reward_da)}
            </span>
          </p>
          <div className="bg-surface-3 mt-3 h-3 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary-600 h-full rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-subtle mt-1 text-xs tabular-nums">
            {formatDA(progress.spent_da)} / {formatDA(progress.threshold_da)}
          </p>
        </div>
      ) : (
        <p className="text-muted py-2 text-center text-sm">
          Aucun avantage disponible pour l&apos;instant — créditez son premier
          achat.
        </p>
      )}

      {fiche?.program && !fiche.program.enabled && (
        <p className="text-warning-700 bg-warning-50 rounded-md p-2.5 text-center text-xs font-medium">
          Programme désactivé : crédits impossibles, réductions autorisées.
        </p>
      )}

      <div className="grid gap-2">
        <Button
          size="lg"
          className="h-14 w-full text-base"
          disabled={!fiche?.program?.enabled}
          onClick={() => {
            setCreditError(null);
            setAmountInput("");
            setView("credit");
          }}
        >
          <Plus className="size-5" />
          Créditer un achat
        </Button>
        {hasReduction && (
          <Button
            variant="outline"
            size="lg"
            className="h-14 w-full text-base"
            onClick={() => setView("redeem")}
          >
            <Minus className="size-5" />
            Appliquer une réduction
          </Button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="text-muted hover:text-foreground py-2 text-sm font-medium"
        >
          Terminer
        </button>
      </div>
    </div>
  );
}
