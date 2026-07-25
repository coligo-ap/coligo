"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  CreditCard,
  Globe,
  Hourglass,
  Loader2,
  Lock,
  ShoppingBag,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { sharedCartChannel } from "@/lib/realtime/broadcast";
import { openCheckout } from "@/lib/payments/open-checkout";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";
import { QrZoom } from "@/components/shared/qr-zoom";
import { ColigoCelebration } from "@/components/driver/onboarding/coligo-celebration";
import {
  startGuestIntlPayment,
  startGuestPayment,
} from "@/app/payer/[ptoken]/actions";
import {
  IntlPaymentSheet,
  type StripeIntentPayload,
} from "@/components/customer/intl-payment-sheet";
import type { FeatureStatus } from "@/lib/data/feature-flags";

// =============================================================================
// GuestPayView — l'invité règle la commande du capitaine. États :
//   pending  → carte rassurante + sélecteur (Edahabia/CIB actif, carte
//              internationale grisée « Bientôt » derrière le flag intl_card)
//   paid     → « Déjà payé ✅ » + micro-célébration (premier paiement gagne :
//              un 2ᵉ payeur retombe TOUJOURS ici, poll 5 s + reprise)
//   expired  → la commande liée a été annulée (le capitaine relance)
// =============================================================================

type PayInfo = {
  captain_name: string | null;
  merchant: { name: string; logo_url: string | null } | null;
  total_da: number;
  payment_status: string;
  order_status: string;
  share_token: string;
  /** Révélés par la RPC APRÈS confirmation du paiement seulement (mig 0411). */
  order_number: string | null;
  pickup_code: string | null;
};

export function GuestPayView({
  ptoken,
  returnState,
  intlStatus,
}: {
  ptoken: string;
  /** Retour Chargily (?st=success|failure) — bannière/attente adaptée. */
  returnState: "success" | "failure" | null;
  intlStatus: FeatureStatus;
}) {
  const t = useTranslations("sharedCart");
  const tOrders = useTranslations("orders");
  const [info, setInfo] = useState<PayInfo | null | "notfound">(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  // Choix du payeur : carte DZ (Chargily) ou INTERNATIONALE (Stripe €).
  const [method, setMethod] = useState<"dz" | "intl">("dz");
  const [intlIntent, setIntlIntent] = useState<StripeIntentPayload | null>(
    null
  );
  const [stripeDone, setStripeDone] = useState(false);
  const [resyncNonce, setResyncNonce] = useState(0);
  // Pop-up « Paiement accepté » : montrée au PAYEUR qui revient (st=success /
  // Stripe validé) ou à quiconque VOIT la transition impayé→payé en direct —
  // jamais à un visiteur qui arrive après coup (carte statique suffisante).
  const sawUnpaid = useRef(false);
  const [paidPopupClosed, setPaidPopupClosed] = useState(false);

  const fetchInfo = useCallback(async () => {
    try {
      const supabase = createClient();
      // RPC hors types générés → bind OBLIGATOIRE (reference_supabase_rpc_bind).
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: PayInfo | null }>;
      const { data } = await rpc("shared_cart_payment_info", {
        p_payment_token: ptoken,
      });
      if (
        data &&
        data.payment_status !== "paid" &&
        data.payment_status !== "refunded"
      ) {
        sawUnpaid.current = true;
      }
      setInfo(data ?? "notfound");
    } catch {
      /* réseau : le poll réessaie */
    }
  }, [ptoken]);

  useEffect(() => {
    void fetchInfo();
    const poll = setInterval(() => void fetchInfo(), 5000);
    return () => clearInterval(poll);
  }, [fetchInfo, resyncNonce]);
  useResumeResync(() => setResyncNonce((n) => n + 1));

  // Temps réel : le webhook bump le canal du panier à la CONFIRMATION du
  // paiement → « Paiement accepté » apparaît sans attendre le poll (5 s).
  const shareToken = info && info !== "notfound" ? info.share_token : null;
  useEffect(() => {
    if (!shareToken) return;
    const supabase = createClient();
    const channel = supabase
      .channel(sharedCartChannel(shareToken))
      .on("broadcast", { event: "bump" }, () => void fetchInfo())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [shareToken, fetchInfo, resyncNonce]);

  const pay = async () => {
    setPayError(null);
    setPaying(true);
    if (method === "intl") {
      // CARTE INTERNATIONALE — Payment Element Stripe EMBARQUÉ (même page,
      // 3DS géré) ; le webhook Stripe existant fait foi.
      const res = await startGuestIntlPayment(ptoken);
      setPaying(false);
      if (res.ok) {
        setIntlIntent(res.intent);
        return;
      }
      if (res.reason === "already_paid") {
        void fetchInfo();
        return;
      }
      setPayError(
        res.reason === "ineligible"
          ? (res.message ?? t("payFailedBanner"))
          : res.reason === "expired"
            ? t("payExpiredDesc")
            : t("payFailedBanner")
      );
      return;
    }
    const res = await startGuestPayment(ptoken);
    if (res.ok) {
      // STANDARD in-app (lib/payments/open-checkout) : web → redirection,
      // APK → navigateur intégré (le poll confirmera au retour).
      await openCheckout(res.url);
      setPaying(false);
      return;
    }
    setPaying(false);
    if (res.reason === "already_paid") {
      void fetchInfo();
      return;
    }
    setPayError(
      res.reason === "expired" ? t("payExpiredDesc") : t("payFailedBanner")
    );
  };

  if (info === null) {
    return (
      <Screen>
        <div className="bg-surface-3 h-64 animate-pulse rounded-[22px]" />
      </Screen>
    );
  }
  if (info === "notfound") {
    return (
      <Screen>
        <Card>
          <span className="bg-surface-2 text-subtle mx-auto grid size-14 place-items-center rounded-2xl">
            <ShoppingBag className="size-7" />
          </span>
          <h1 className="text-foreground mt-3 text-center text-lg font-extrabold">
            {t("notFoundTitle")}
          </h1>
          <p className="text-muted mt-1 text-center text-sm">
            {t("notFoundDesc")}
          </p>
        </Card>
      </Screen>
    );
  }

  const paid =
    info.payment_status === "paid" || info.payment_status === "refunded";
  const expired = info.order_status === "cancelled" && !paid;
  const confirming =
    !paid && !expired && (returnState === "success" || stripeDone);

  // ── PAYÉ — payeur de retour (pop-up « Paiement accepté ») ou 2ᵉ visiteur. ──
  if (paid) {
    const freshPayment =
      returnState === "success" || stripeDone || sawUnpaid.current;
    const showPopup = freshPayment && !paidPopupClosed;
    // Numéro + code de retrait + QR — mêmes gabarits que la fiche commande.
    const paidDetails = (
      <div className="mt-4 space-y-2.5">
        {info.order_number && (
          <div className="bg-surface-2 flex items-center justify-between rounded-[14px] px-4 py-2.5">
            <span className="text-muted text-xs font-bold">
              {t("paidOrderNo")}
            </span>
            <span className="text-foreground text-base font-black tabular-nums">
              {info.order_number}
            </span>
          </div>
        )}
        {info.pickup_code && (
          <div className="border-primary-100 bg-primary-50 rounded-[16px] border p-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-primary-800 text-[12.5px] font-extrabold">
                {tOrders("codeToGiveMerchant")}
              </span>
              <span className="text-primary-600 text-[26px] leading-none font-black tracking-[6px] tabular-nums">
                {info.pickup_code}
              </span>
            </div>
            <div className="border-primary-100 mt-3 flex items-center gap-3.5 border-t pt-3">
              <QrZoom
                value={info.pickup_code}
                size={92}
                fullValue={info.pickup_code}
                caption={tOrders("codeScanHintMerchant")}
              />
              <p className="text-primary-700/90 text-[12px] font-semibold">
                {tOrders("codeScanHintMerchant")}
                <span className="mt-1 block text-[11px] font-bold opacity-80">
                  {tOrders("tapToEnlarge")}
                </span>
              </p>
            </div>
          </div>
        )}
      </div>
    );
    return (
      <Screen>
        <Card>
          <ColigoCelebration variant="verified" />
          <h1 className="text-foreground mt-2 text-center text-xl font-extrabold">
            {freshPayment ? t("paidPopupTitle") : t("alreadyPaid")}
          </h1>
          <p className="text-muted mt-1 text-center text-sm">
            {t("alreadyPaidDesc", {
              name: info.captain_name ?? t("captain"),
            })}
          </p>
          <p className="text-foreground mt-4 text-center text-2xl font-black tabular-nums">
            {formatDA(info.total_da)}
          </p>
          <p className="text-subtle mt-0.5 text-center text-xs font-semibold">
            {info.merchant?.name}
          </p>
          {paidDetails}
        </Card>

        {/* Pop-up célébration — uniquement pour un paiement FRAIS (retour
            Chargily/Stripe ou transition vue en direct), jamais en revisite. */}
        {showPopup && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] backdrop-blur-[2px] sm:items-center"
          >
            <style>{`@keyframes gpPaidPop{from{opacity:0;transform:translateY(28px) scale(.95)}to{opacity:1;transform:none}}`}</style>
            <div className="bg-surface w-full max-w-sm [animation:gpPaidPop_.4s_cubic-bezier(.18,.9,.28,1.15)_both] rounded-[22px] p-5 shadow-[0_24px_60px_-18px_rgba(20,10,60,.55)]">
              <ColigoCelebration variant="verified" />
              <h2 className="text-foreground mt-2 text-center text-xl font-extrabold">
                {t("paidPopupTitle")}
              </h2>
              <p className="text-muted mt-1 text-center text-sm">
                {t("paidPopupDesc", {
                  merchant: info.merchant?.name ?? "Coligo",
                })}
              </p>
              {paidDetails}
              <button
                type="button"
                onClick={() => setPaidPopupClosed(true)}
                className="bg-primary-600 hover:bg-primary-700 mt-4 w-full rounded-[14px] px-4 py-3.5 text-base font-extrabold text-white transition active:scale-[0.98]"
              >
                {t("paidPopupClose")}
              </button>
            </div>
          </div>
        )}
      </Screen>
    );
  }

  // ── LIEN EXPIRÉ (commande annulée — le capitaine reprend la main). ──
  if (expired) {
    return (
      <Screen>
        <Card>
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-amber-50 text-amber-600">
            <Hourglass className="size-7" />
          </span>
          <h1 className="text-foreground mt-3 text-center text-lg font-extrabold">
            {t("payExpired")}
          </h1>
          <p className="text-muted mt-1 text-center text-sm">
            {t("payExpiredDesc")}
          </p>
        </Card>
      </Screen>
    );
  }

  // ── PAIEMENT EN ATTENTE — la carte rassurante. ──
  return (
    <Screen>
      <Card>
        {info.merchant?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={info.merchant.logo_url}
            alt=""
            className="bg-surface-2 mx-auto size-14 rounded-2xl object-cover"
          />
        ) : (
          <span className="bg-primary-50 text-primary-600 mx-auto grid size-14 place-items-center rounded-2xl">
            <ShoppingBag className="size-7" />
          </span>
        )}
        <h1 className="text-foreground mt-3 text-center text-lg leading-snug font-extrabold">
          {t("payTitle", { name: info.captain_name ?? t("captain") })}
        </h1>
        <p className="text-muted mt-0.5 text-center text-sm font-semibold">
          {info.merchant?.name}
        </p>

        <div className="bg-surface-2 mt-4 rounded-[16px] px-4 py-3 text-center">
          <p className="text-muted text-[11px] font-bold tracking-wide uppercase">
            {t("payAmountLabel")}
          </p>
          <p className="text-foreground text-3xl font-black tabular-nums">
            {formatDA(info.total_da)}
          </p>
        </div>

        {confirming ? (
          <div className="mt-4 flex items-center justify-center gap-2 rounded-[13px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            <Loader2 className="size-4 animate-spin" />
            {t("payPendingConfirm")}
          </div>
        ) : (
          <>
            {(returnState === "failure" || payError) && (
              <p className="mt-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-center text-sm font-medium text-rose-800">
                {payError ?? t("payFailedBanner")}
              </p>
            )}

            {/* Sélecteur : carte DZ (Chargily) OU carte INTERNATIONALE
                (Stripe €, actif — éligibilité pays/plafonds au moment T). */}
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => setMethod("dz")}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[14px] border-2 px-3.5 py-3 text-start transition-colors",
                  method === "dz"
                    ? "border-primary-400 bg-primary-50/50"
                    : "border-border"
                )}
              >
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-[10px]",
                    method === "dz"
                      ? "bg-primary-600 text-white"
                      : "bg-surface-2 text-subtle"
                  )}
                >
                  <CreditCard className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block text-sm font-extrabold">
                    {t("payEdahabia")}
                  </span>
                  <span className="text-muted block text-[11px] font-semibold">
                    {t("payEdahabiaSub")}
                  </span>
                </span>
                {method === "dz" && (
                  <CheckCircle2 className="text-primary-600 size-5 shrink-0" />
                )}
              </button>
              {intlStatus !== "hidden" &&
                (intlStatus === "active" ? (
                  <button
                    type="button"
                    onClick={() => setMethod("intl")}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[14px] border-2 px-3.5 py-3 text-start transition-colors",
                      method === "intl"
                        ? "border-primary-400 bg-primary-50/50"
                        : "border-border"
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-9 shrink-0 place-items-center rounded-[10px]",
                        method === "intl"
                          ? "bg-primary-600 text-white"
                          : "bg-surface-2 text-subtle"
                      )}
                    >
                      <Globe className="size-4.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block text-sm font-extrabold">
                        {t("payIntl")}
                      </span>
                      <span className="text-muted block text-[11px] font-semibold">
                        {t("payIntlSub")}
                      </span>
                    </span>
                    {method === "intl" && (
                      <CheckCircle2 className="text-primary-600 size-5 shrink-0" />
                    )}
                  </button>
                ) : (
                  <div className="border-border flex items-center gap-3 rounded-[14px] border-2 px-3.5 py-3 opacity-55">
                    <span className="bg-surface-2 text-subtle grid size-9 shrink-0 place-items-center rounded-[10px]">
                      <Globe className="size-4.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block text-sm font-extrabold">
                        {t("payIntl")}
                      </span>
                      <span className="text-muted block text-[11px] font-semibold">
                        {t("payIntlSoon")}
                      </span>
                    </span>
                  </div>
                ))}
            </div>

            <button
              type="button"
              onClick={() => void pay()}
              disabled={paying}
              className="bg-primary-600 hover:bg-primary-700 mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[14px] px-4 py-4 text-base font-extrabold text-white shadow-[0_10px_24px_-8px_rgba(91,46,255,0.5)] transition active:scale-[0.98] disabled:opacity-60"
            >
              {paying ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Lock className="size-4.5" />
              )}
              {t("payCta", { amount: formatDA(info.total_da) })}
            </button>
            <p className="text-subtle mt-2.5 flex items-center justify-center gap-1 text-center text-[11px] font-semibold">
              <Lock className="size-3" />
              {t("paySecure")}
            </p>
          </>
        )}
      </Card>

      {/* Feuille Stripe EMBARQUÉE (Payment Element / PaymentSheet native). */}
      {intlIntent && (
        <IntlPaymentSheet
          intent={intlIntent}
          onSuccess={() => {
            setIntlIntent(null);
            setStripeDone(true);
            void fetchInfo();
          }}
          onClose={() => setIntlIntent(null)}
        />
      )}
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-2 grid min-h-dvh place-items-center px-4 py-[calc(env(safe-area-inset-top)+1rem)]">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-[22px] p-5 shadow-[0_18px_44px_-20px_rgba(40,35,90,.35)]">
      {children}
    </div>
  );
}
