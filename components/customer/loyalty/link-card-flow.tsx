"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Gift,
  Keyboard,
  Loader2,
  ScanLine,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDA } from "@/lib/utils";
import { QrScanner } from "@/components/scanner/qr-scanner";
import { extractLoyaltyIdentifier } from "@/lib/merchant/scan-detect";
import { OrderCelebrationDecor } from "@/components/customer/order-celebration";
import {
  linkLoyaltyCard,
  type LinkCardResult,
} from "@/app/(customer)/cashback/actions";

type View = "choice" | "scan" | "manual" | "celebrate";

/**
 * Liaison d'une carte fidélité au compte (SPEC-FIDELITE 3.1/3.2) — flux
 * PARTAGÉ entre l'étape d'onboarding et la section « Cashback & Fidélité » :
 *   • Scanner (caméra) + SAISIE MANUELLE du numéro 16 caractères (secours
 *     caméra — tolérante à la casse, aux espaces et aux tirets) ;
 *   • « Passer » (onboarding) aussi VISIBLE que « Scanner » — jamais bloquant ;
 *   • succès → célébration : solde récupéré par magasin + bonus de liaison.
 */
export function LinkCardFlow({
  variant,
  prefillCode = null,
  onSkip,
  onFinish,
  onLinked,
}: {
  variant: "onboarding" | "sheet";
  prefillCode?: string | null;
  /** Onboarding uniquement : bouton « Passer cette étape » (même taille). */
  onSkip?: () => void;
  /** Fin du flux (après célébration, ou carte déjà liée à ce compte). */
  onFinish: () => void;
  /** Notifie le parent qu'une liaison a réussi (invalidation de cache). */
  onLinked?: () => void;
}) {
  const t = useTranslations("wallet");
  const prefillValid = prefillCode
    ? extractLoyaltyIdentifier(prefillCode)
    : null;
  const [view, setView] = useState<View>(prefillValid ? "manual" : "choice");
  const [manual, setManual] = useState(prefillCode ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanNonce, setScanNonce] = useState(0);
  const [result, setResult] = useState<LinkCardResult | null>(null);

  function errorFor(code: string | undefined): string {
    switch (code) {
      case "not_found":
        return t("loyErrNotFound");
      case "blocked":
        return t("loyErrBlocked");
      case "already_linked":
        return t("loyErrAlreadyLinked");
      case "feature_disabled":
        return t("loyErrFeature");
      case "rate_limited":
        return t("loyErrRate");
      default:
        return t("loyErrNetwork");
    }
  }

  async function submit(identifier: string) {
    setError(null);
    setPending(true);
    try {
      const res = await linkLoyaltyCard(identifier);
      if (!res.ok) {
        setError(errorFor(res.code));
        setScanNonce((n) => n + 1); // réarme la caméra oneShot
        return;
      }
      onLinked?.();
      setResult(res);
      setView("celebrate");
    } finally {
      setPending(false);
    }
  }

  function handleScan(text: string) {
    if (pending) return;
    if (/^coligo:user:/i.test(text.trim())) {
      // C'est le QR PERSONNEL du client, pas une carte de magasin.
      setError(t("loyErrOwnQr"));
      setScanNonce((n) => n + 1);
      return;
    }
    const id = extractLoyaltyIdentifier(text);
    if (!id) {
      setError(t("loyErrNotACard"));
      setScanNonce((n) => n + 1);
      return;
    }
    void submit(id);
  }

  function submitManual() {
    const id = extractLoyaltyIdentifier(manual);
    if (!id || /^coligo:user:/i.test(manual.trim())) {
      setError(t("loyErrManualFormat"));
      return;
    }
    void submit(id);
  }

  /* ------------------------------ célébration --------------------------- */
  if (view === "celebrate" && result) {
    const moved = result.moved ?? [];
    const totalMoved = moved.reduce((s, m) => s + m.amount_da, 0);
    const bonus = result.bonus_da ?? 0;
    return (
      <div className="text-center">
        <OrderCelebrationDecor
          title={result.already ? t("loyLinkedAlready") : t("loyLinkedTitle")}
        />
        <div className="mt-3 space-y-2">
          {moved.map((m) => (
            <div
              key={m.merchant_id}
              className="border-success-200 bg-success-50 flex items-center justify-between rounded-md border p-3 text-start"
            >
              <span className="text-success-800 flex min-w-0 items-center gap-2 text-sm font-bold">
                <Gift className="size-4 shrink-0" />
                <span className="truncate">{m.merchant_name}</span>
              </span>
              <span className="text-success-700 text-base font-extrabold tabular-nums">
                +{formatDA(m.amount_da)}
              </span>
            </div>
          ))}
          {bonus > 0 && (
            <div className="border-primary-200 bg-primary-50 flex items-center justify-between rounded-md border p-3 text-start">
              <span className="text-primary-800 flex min-w-0 items-center gap-2 text-sm font-bold">
                <Sparkles className="size-4 shrink-0" />
                <span className="truncate">
                  {t("loyLinkedBonusAt", {
                    merchant: result.bonus_merchant ?? "Coligo",
                  })}
                </span>
              </span>
              <span className="text-primary-700 text-base font-extrabold tabular-nums">
                +{formatDA(bonus)}
              </span>
            </div>
          )}
          {!result.already && moved.length === 0 && bonus === 0 && (
            <p className="text-muted text-sm font-medium">
              {t("loyLinkedEmpty")}
            </p>
          )}
          {totalMoved > 0 && (
            <p className="text-foreground text-sm font-semibold">
              {t("loyLinkedRecovered", {
                amount: formatDA(totalMoved + bonus),
              })}
            </p>
          )}
        </div>
        <Button size="lg" className="mt-4 h-14 w-full" onClick={onFinish}>
          {t("loyLinkedCta")}
        </Button>
      </div>
    );
  }

  /* -------------------------------- caméra ------------------------------ */
  if (view === "scan") {
    return (
      <div className="space-y-3">
        <QrScanner
          key={scanNonce}
          onScan={handleScan}
          oneShot
          className="mx-auto max-w-[280px]"
        />
        {pending && (
          <p className="text-muted flex items-center justify-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t("loyLinking")}
          </p>
        )}
        {error && (
          <p className="text-danger-600 text-center text-sm font-medium">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="lg"
            className="h-12"
            disabled={pending}
            onClick={() => {
              setError(null);
              setView("choice");
            }}
          >
            <ArrowLeft className="size-4 rtl:-scale-x-100" />
            {t("loyBack")}
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-12"
            disabled={pending}
            onClick={() => {
              setError(null);
              setView("manual");
            }}
          >
            <Keyboard className="size-4" />
            {t("loyLinkManual")}
          </Button>
        </div>
      </div>
    );
  }

  /* --------------------------- saisie manuelle --------------------------- */
  if (view === "manual") {
    return (
      <div className="space-y-3">
        <label
          htmlFor="loyalty-card-code"
          className="text-foreground block text-sm font-semibold"
        >
          {t("loyLinkManualLabel")}
        </label>
        <input
          id="loyalty-card-code"
          autoFocus
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          value={manual}
          onChange={(e) => {
            setManual(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitManual();
            }
          }}
          placeholder="ABCD 2345 EFGH 2345"
          className="border-border-strong focus:border-primary-400 focus:ring-primary-400/40 h-14 w-full rounded-md border text-center font-mono text-lg font-bold tracking-widest uppercase focus:ring-2 focus:outline-none"
        />
        <p className="text-subtle text-xs">{t("loyLinkManualHint")}</p>
        {error && (
          <p className="text-danger-600 text-sm font-medium">{error}</p>
        )}
        <Button
          size="lg"
          className="h-14 w-full"
          disabled={pending || manual.trim().length === 0}
          onClick={submitManual}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Gift className="size-4" />
          )}
          {t("loyLinkSubmit")}
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="h-12 w-full"
          disabled={pending}
          onClick={() => {
            setError(null);
            setView("choice");
          }}
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" />
          {t("loyBack")}
        </Button>
      </div>
    );
  }

  /* ------------------------------- choix -------------------------------- */
  // « Passer » AUSSI VISIBLE que « Scanner » (exigence propriétaire) : trois
  // boutons pleine largeur de MÊME taille, jamais un lien discret.
  return (
    <div className="space-y-2">
      {error && (
        <p className="text-danger-600 text-center text-sm font-medium">
          {error}
        </p>
      )}
      <Button
        size="lg"
        className="h-14 w-full text-base"
        onClick={() => {
          setError(null);
          setView("scan");
        }}
      >
        <ScanLine className="size-5" />
        {t("loyLinkScan")}
      </Button>
      <Button
        variant="outline"
        size="lg"
        className="h-14 w-full text-base"
        onClick={() => {
          setError(null);
          setView("manual");
        }}
      >
        <Keyboard className="size-5" />
        {t("loyLinkManual")}
      </Button>
      {variant === "onboarding" && onSkip && (
        <Button
          variant="outline"
          size="lg"
          className="h-14 w-full text-base"
          onClick={onSkip}
        >
          {t("loyLinkSkip")}
        </Button>
      )}
    </div>
  );
}
