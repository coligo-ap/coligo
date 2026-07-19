"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  closeCheckout,
  isNativeApp,
  openCheckout,
} from "@/lib/payments/open-checkout";
import {
  CheckCircle2,
  CreditCard,
  Globe,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  createOperatorTopupCheckout,
  createOperatorTopupIntlPayment,
  getMyWalletEntries,
  walletIntlAvailability,
  type MyWalletEntry,
} from "@/app/wallet/recharge-actions";
import {
  IntlPaymentSheet,
  type StripeIntentPayload,
} from "@/components/customer/intl-payment-sheet";
import {
  BRAND_GO,
  BRAND_RED,
  PartnerBackHeader,
  PartnerInlineError,
  SORA,
} from "@/components/shared/partner-ui";
import {
  PayCard,
  PayPrimaryButton,
  PayScreen,
  groupNum,
  invalidatePayCache,
  payHref,
  usePayLang,
  usePayWallet,
  type PayBase,
} from "./pay-core";
import { haptic } from "@/lib/native/haptics";

type Mode = "form" | "checking" | "confirmed" | "failed" | "slow";

/**
 * RECHARGER PAR CARTE — un seul objectif par écran : le montant, puis le
 * paiement Chargily, puis un écran de RÉSULTAT dédié (succès / échec /
 * vérification en cours). Le retour Chargily atterrit ICI (`?topup=`).
 *
 * Sécurité inchangée : on ne croit JAMAIS la redirection `?topup=success`
 * (forgeable) — la seule preuve est l'écriture `topup_chargily` posée par le
 * webhook (HMAC, idempotent), qu'on attend en pollant.
 */
export function PayCardTopup({ base }: { base: PayBase }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { lang, t, tr, dir } = usePayLang();
  const { config, refresh } = usePayWallet({ withConfig: true });

  const [mode, setMode] = useState<Mode>("form");
  // Retour haptique à l'entrée d'un état terminal (confirmé / échoué).
  useEffect(() => {
    if (mode === "confirmed") haptic("success");
    else if (mode === "failed") haptic("error");
  }, [mode]);
  // Rail carte : CIB/Edahabia (DA, Chargily, défaut) ou carte internationale
  // (€, Stripe — si le super-admin l'a activée, mig 0389).
  const [rail, setRail] = useState<"dzd" | "eur">("dzd");
  const [intlAvailable, setIntlAvailable] = useState(false);
  const [intlIntent, setIntlIntent] = useState<StripeIntentPayload | null>(
    null
  );
  useEffect(() => {
    void walletIntlAvailability().then(setIntlAvailable);
  }, []);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittingRef = useRef(false);

  const amt = Number(amount);
  const amtValid = Number.isFinite(amt) && amt >= 100;
  const presets = config?.presets ?? [500, 1000, 2000, 5000];

  // Attente de la CONFIRMATION réelle (écriture webhook `topup_chargily`
  // depuis `since`) — partagée entre le retour web (`?topup=success`) et le
  // paiement NATIF dans le navigateur intégré (l'app reste montée dessous).
  const startConfirmationPolling = useCallback(
    (since: number) => {
      setMode("checking");
      const credited = (en: MyWalletEntry[]) =>
        en.some(
          (e) =>
            e.type === "topup_chargily" &&
            new Date(e.createdAt).getTime() >= since
        );
      let tries = 0;
      const tick = async () => {
        tries += 1;
        let en: MyWalletEntry[] = [];
        try {
          en = await getMyWalletEntries();
        } catch {
          /* réseau — on retentera au tick suivant */
        }
        if (credited(en)) {
          if (pollRef.current) clearInterval(pollRef.current);
          invalidatePayCache();
          void refresh();
          // Referme l'onglet de paiement intégré (iOS ; no-op Android).
          void closeCheckout();
          setMode("confirmed");
        } else if (tries >= 60) {
          // ~3 min : en natif l'utilisateur peut rester un moment sur la page
          // de paiement — au-delà, écran « délai » (le webhook créditera).
          if (pollRef.current) clearInterval(pollRef.current);
          setMode("slow");
        }
      };
      void tick();
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => void tick(), 3000);
    },
    [refresh]
  );
  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    []
  );

  // Retour Chargily WEB : ?topup=success → attendre l'écriture webhook ;
  // ?topup=failed → écran d'échec. (En natif, pas de retour : on polle direct.)
  useEffect(() => {
    const flag = search.get("topup");
    if (!flag) return;
    router.replace(pathname);
    let startedAt = 0;
    try {
      const raw = window.localStorage.getItem("coligo_op_topup_started");
      startedAt = raw ? Number(raw) : 0;
      window.localStorage.removeItem("coligo_op_topup_started");
    } catch {
      /* localStorage indisponible */
    }
    if (flag === "failed") {
      setMode("failed");
      return;
    }
    if (flag !== "success") return;
    startConfirmationPolling(
      startedAt > 0 ? startedAt - 90_000 : Date.now() - 600_000
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const payCard = async () => {
    if (!amtValid || busy || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setErr(null);
    try {
      // Rail INTERNATIONAL (€) : feuille de paiement Stripe EMBARQUÉE ; le
      // webhook crédite le portefeuille, on polle la confirmation ensuite.
      if (rail === "eur") {
        const res = await createOperatorTopupIntlPayment(amt);
        if (!res.ok) {
          setErr(
            res.error?.startsWith("intl_")
              ? tr.payUnavailable
              : (res.error ?? tr.payUnavailable)
          );
          return;
        }
        setIntlIntent({
          client_secret: res.client_secret,
          publishable_key: res.publishable_key,
          eur_cents: res.eur_cents,
          total_da: res.total_da,
        });
        return;
      }
      // Rail CIB/Edahabia — Chargily. NATIF : retour sur la page publique
      // minimale (l'onglet intégré n'a pas la session app). WEB : retour ici.
      const res = await createOperatorTopupCheckout(
        amt,
        isNativeApp() ? "/paiement/retour" : payHref(base, "/carte")
      );
      if (!res.ok || !res.url) {
        setErr(res.error ?? tr.payUnavailable);
        return;
      }
      const started = Date.now();
      try {
        window.localStorage.setItem("coligo_op_topup_started", String(started));
      } catch {
        /* localStorage indisponible */
      }
      const opened = await openCheckout(res.url);
      if (opened === "inapp") {
        // L'app reste montée sous l'onglet de paiement : on attend le webhook.
        startConfirmationPolling(started - 90_000);
      }
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  /* ── Écrans de résultat (une info, une action) ── */

  if (mode === "checking") {
    return (
      <ResultScreen dir={dir}>
        <Loader2
          className="mx-auto size-10 animate-spin"
          style={{ color: "var(--d-violet)" }}
        />
        <p className="mt-4 text-[15px] font-extrabold text-[var(--d-ink)]">
          {t.checkingPay}
        </p>
      </ResultScreen>
    );
  }
  if (mode === "confirmed") {
    return (
      <ResultScreen dir={dir}>
        <CheckCircle2 className="mx-auto size-12" style={{ color: BRAND_GO }} />
        <p
          className="mt-4 text-[18px] font-extrabold text-[var(--d-ink)]"
          style={{ fontFamily: SORA }}
        >
          {t.confirmedTitle}
        </p>
        <p className="mt-1 text-[12.5px] font-medium text-[var(--d-muted)]">
          {t.confirmedSub}
        </p>
        <div className="mt-5 space-y-2">
          <PayPrimaryButton href={payHref(base)}>
            {t.backToWallet}
          </PayPrimaryButton>
          <SecondaryLink href={payHref(base, "/historique")}>
            {t.viewHistory}
          </SecondaryLink>
        </div>
      </ResultScreen>
    );
  }
  if (mode === "failed") {
    return (
      <ResultScreen dir={dir}>
        <XCircle className="mx-auto size-12" style={{ color: BRAND_RED }} />
        <p
          className="mt-4 text-[18px] font-extrabold text-[var(--d-ink)]"
          style={{ fontFamily: SORA }}
        >
          {t.failedTitle}
        </p>
        <p className="mt-1 text-[12.5px] font-medium text-[var(--d-muted)]">
          {t.failedSub}
        </p>
        <div className="mt-5 space-y-2">
          <PayPrimaryButton onClick={() => setMode("form")}>
            {t.retry}
          </PayPrimaryButton>
          <SecondaryLink href={payHref(base)}>{t.backToWallet}</SecondaryLink>
        </div>
      </ResultScreen>
    );
  }
  if (mode === "slow") {
    return (
      <ResultScreen dir={dir}>
        <Loader2
          className="mx-auto size-10"
          style={{ color: "var(--d-violet)" }}
        />
        <p className="mt-4 text-[15px] font-extrabold text-[var(--d-ink)]">
          {t.delayTitle}
        </p>
        <p className="mt-1 text-[12.5px] font-medium text-[var(--d-muted)]">
          {tr.ccpNote}
        </p>
        <div className="mt-5">
          <PayPrimaryButton href={payHref(base)}>
            {t.backToWallet}
          </PayPrimaryButton>
        </div>
      </ResultScreen>
    );
  }

  /* ── Formulaire montant ── */

  return (
    <PayScreen dir={dir}>
      <PartnerBackHeader
        title={tr.mCard}
        subtitle={tr.mCardDelay}
        href={payHref(base, "/methode")}
      />

      <PayCard className="p-3.5">
        {/* Rail carte sur UNE ligne — CIB/Edahabia (défaut) + internationale
            (€), affiché seulement si le super-admin a activé la carte € pour la
            recharge du portefeuille (mig 0389). */}
        {intlAvailable && (
          <div className="mb-3 flex gap-2">
            {(
              [
                ["dzd", CreditCard, tr.mCard, tr.mCardDelay],
                [
                  "eur",
                  Globe,
                  lang === "ar" ? "دولية (€)" : "Internationale (€)",
                  "Visa · Mastercard",
                ],
              ] as const
            ).map(([r, Icon, label, sub]) => {
              const on = rail === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRail(r)}
                  className="flex-1 rounded-[12px] border-[1.5px] px-2.5 py-2 text-start"
                  style={
                    on
                      ? {
                          borderColor: "var(--d-violet)",
                          background: "var(--d-accent)",
                          color: "var(--d-violet)",
                        }
                      : {
                          borderColor: "var(--d-line)",
                          color: "var(--d-muted)",
                        }
                  }
                >
                  <span className="flex items-center gap-1.5">
                    <Icon className="size-3.5 shrink-0" />
                    <b className="text-[12px]">{label}</b>
                  </span>
                  <span className="mt-0.5 block text-[10px] font-semibold text-[var(--d-muted)]">
                    {sub}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <p className="mb-2 text-[12.5px] font-bold text-[var(--d-muted)]">
          {tr.amountLabel}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {presets.map((v) => {
            const on = Number(amount) === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(String(v))}
                className="rounded-[12px] border py-2.5 text-[13px] font-extrabold"
                style={
                  on
                    ? {
                        background: "var(--d-violet)",
                        borderColor: "var(--d-violet)",
                        color: "#fff",
                      }
                    : {
                        background: "var(--d-surface)",
                        borderColor: "var(--d-line)",
                        color: "var(--d-ink)",
                      }
                }
              >
                {groupNum(v)} DA
              </button>
            );
          })}
        </div>
        <input
          className="mt-2.5 w-full rounded-[12px] border border-[var(--d-line)] bg-[var(--d-field)] px-3.5 py-3 text-[13.5px] font-bold text-[var(--d-ink)] outline-none placeholder:font-medium placeholder:text-[var(--d-muted)]"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
          inputMode="numeric"
          placeholder={tr.otherAmount}
        />
        <div className="mt-3">
          <PayPrimaryButton
            onClick={() => void payCard()}
            disabled={!amtValid || busy}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : rail === "eur" ? (
              <Globe className="size-4" />
            ) : (
              <CreditCard className="size-4" />
            )}
            {t.continue}
          </PayPrimaryButton>
        </div>
        {err && (
          <div className="mt-2">
            <PartnerInlineError>{err}</PartnerInlineError>
          </div>
        )}
      </PayCard>

      <p className="mt-3 flex items-start justify-center gap-1.5 px-4 text-center text-[11.5px] font-medium text-[var(--d-muted)]">
        <ShieldCheck
          className="mt-[1px] size-3.5 shrink-0"
          style={{ color: BRAND_GO }}
        />
        {tr.cardNote}
      </p>

      {/* Rail € : feuille de paiement Stripe embarquée. Succès → le webhook
          crédite le portefeuille ; on polle la confirmation puis écran confirmé. */}
      {intlIntent && (
        <IntlPaymentSheet
          intent={intlIntent}
          onSuccess={() => {
            setIntlIntent(null);
            invalidatePayCache();
            void refresh();
            startConfirmationPolling(Date.now() - 90_000);
          }}
          onClose={() => setIntlIntent(null)}
        />
      )}
    </PayScreen>
  );
}

function ResultScreen({
  dir,
  children,
}: {
  dir: "ltr" | "rtl";
  children: React.ReactNode;
}) {
  return (
    <section dir={dir} className="mx-auto w-full max-w-[560px]">
      <div className="rounded-[22px] border border-[var(--d-line)] bg-[var(--d-surface)] px-5 py-10 text-center">
        {children}
      </div>
    </section>
  );
}

function SecondaryLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch
      className="flex w-full items-center justify-center rounded-[14px] border border-[var(--d-line)] py-3 text-[13px] font-bold text-[var(--d-ink)]"
    >
      {children}
    </Link>
  );
}
