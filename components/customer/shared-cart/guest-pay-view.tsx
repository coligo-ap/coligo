"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
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
import { useBroadcastBump } from "@/lib/realtime/use-broadcast-bump";
import { openCheckout } from "@/lib/payments/open-checkout";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";
import { GuestHeader } from "@/components/customer/shared-cart/guest-header";
import { QrZoom } from "@/components/shared/qr-zoom";
import { ColigoCelebration } from "@/components/driver/onboarding/coligo-celebration";
import { PaidCelebrationSheet } from "@/components/customer/shared-cart/paid-celebration-sheet";
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
  /** Livraison : le PIN est le code LIVREUR du destinataire — jamais ici. */
  is_delivery: boolean;
  /** Choix du PROPRIÉTAIRE, visibles AVANT paiement (mig 0422) : l'invité
   *  sait ce qu'il règle — mode + adresse + frais inclus dans le total. */
  delivery_mode: "express" | "tour" | null;
  delivery_address_text: string | null;
  delivery_fee_da: number | null;
  /** Détail des montants (mig 0423) — transparence totale avant paiement. */
  subtotal_da: number | null;
  service_fee_da: number | null;
  /** Articles de la commande (mig 0427) — même récap que le checkout. */
  items:
    | {
        name: string;
        qty: number;
        unit: string | null;
        line_total_da: number;
      }[]
    | null;
  /** Révélés APRÈS paiement et AU PAYEUR seulement (secret mig 0412). */
  order_number: string | null;
  pickup_code: string | null;
};

/** Secret de révélation (mig 0412) — remis au navigateur qui DÉMARRE le
 * paiement, seul habilité à voir numéro + code après confirmation. */
function revealKey(ptoken: string) {
  return `coligo_reveal_${ptoken}`;
}
function readReveal(ptoken: string): string | null {
  try {
    return localStorage.getItem(revealKey(ptoken));
  } catch {
    return null;
  }
}
function saveReveal(ptoken: string, secret: string) {
  try {
    localStorage.setItem(revealKey(ptoken), secret);
  } catch {
    /* stockage indispo : le payeur verra « payé » sans les codes */
  }
}

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
  // Ordonnancement des réponses : une réponse PÉRIMÉE (poll parti avant le
  // paiement, arrivé après le bump) ne doit ni écraser l'état « payé » ni
  // réarmer la pop-up via sawUnpaid — on n'applique que les réponses plus
  // récentes que la dernière appliquée.
  const fetchSeq = useRef(0);
  const fetchApplied = useRef(0);

  const fetchInfo = useCallback(async () => {
    const seq = ++fetchSeq.current;
    try {
      const supabase = createClient();
      // RPC hors types générés → bind OBLIGATOIRE (reference_supabase_rpc_bind).
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: PayInfo | null }>;
      const { data } = await rpc("shared_cart_payment_info", {
        p_payment_token: ptoken,
        p_reveal: readReveal(ptoken),
      });
      if (seq < fetchApplied.current) return; // réponse périmée
      fetchApplied.current = seq;
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
  // Topic serveur FIXE partagé avec la room ⇒ abonnement anti-collision
  // (reference_realtime_channel_topic_collision).
  const shareToken = info && info !== "notfound" ? info.share_token : null;
  useBroadcastBump(
    shareToken ? sharedCartChannel(shareToken) : null,
    "bump",
    () => void fetchInfo(),
    resyncNonce
  );

  const pay = async () => {
    setPayError(null);
    setPaying(true);
    if (method === "intl") {
      // CARTE INTERNATIONALE — Payment Element Stripe EMBARQUÉ (même page,
      // 3DS géré) ; le webhook Stripe existant fait foi.
      const res = await startGuestIntlPayment(ptoken);
      setPaying(false);
      if (res.ok) {
        saveReveal(ptoken, res.reveal);
        setIntlIntent(res.intent);
        return;
      }
      if (res.reason === "already_paid") {
        void fetchInfo();
        return;
      }
      setPayError(
        res.reason === "throttled"
          ? t("payThrottled")
          : res.reason === "ineligible"
            ? (res.message ?? t("payFailedBanner"))
            : res.reason === "expired"
              ? t("payExpiredDesc", {
                  name:
                    (info !== "notfound" ? info?.captain_name : null) ??
                    t("captain"),
                })
              : t("payFailedBanner")
      );
      return;
    }
    const res = await startGuestPayment(ptoken);
    if (res.ok) {
      saveReveal(ptoken, res.reveal);
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
      res.reason === "throttled"
        ? t("payThrottled")
        : res.reason === "expired"
          ? t("payExpiredDesc", {
              name:
                (info !== "notfound" ? info?.captain_name : null) ??
                t("captain"),
            })
          : t("payFailedBanner")
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

          <Link
            href="/"
            className="border-border text-foreground mt-4 flex h-11 w-full items-center justify-center rounded-[13px] border text-sm font-bold"
          >
            {t("goHome")}
          </Link>
        </Card>
      </Screen>
    );
  }

  // « refunded » n'est PAS un succès : commande annulée après paiement —
  // écran dédié, jamais la célébration ni le code de retrait.
  const paid = info.payment_status === "paid";
  const refunded = info.payment_status === "refunded";
  const expired = info.order_status === "cancelled" && !paid && !refunded;
  const confirming =
    !paid && !refunded && !expired && (returnState === "success" || stripeDone);

  // ── REMBOURSÉ — commande annulée après paiement (l'argent est rendu). ──
  if (refunded) {
    return (
      <Screen>
        <Card>
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-amber-50 text-amber-600">
            <Hourglass className="size-7" />
          </span>
          <h1 className="text-foreground mt-3 text-center text-lg font-extrabold">
            {t("payRefunded")}
          </h1>
          <p className="text-muted mt-1 text-center text-sm">
            {t("payRefundedDesc")}
          </p>
          <p className="text-foreground mt-4 text-center text-2xl font-black tabular-nums">
            {formatDA(info.total_da)}
          </p>
          <p className="text-subtle mt-0.5 text-center text-xs font-semibold">
            {info.merchant?.name}
          </p>
          <Link
            href="/"
            className="border-border text-foreground mt-4 flex h-11 w-full items-center justify-center rounded-[13px] border text-sm font-bold"
          >
            {t("goHome")}
          </Link>
        </Card>
      </Screen>
    );
  }

  // ── PAYÉ — payeur de retour (pop-up « Paiement accepté ») ou 2ᵉ visiteur. ──
  if (paid) {
    const freshPayment =
      returnState === "success" || stripeDone || sawUnpaid.current;
    const showPopup = freshPayment && !paidPopupClosed;
    // Numéro + code de retrait + QR (retrait seulement — en livraison le PIN
    // est le code LIVREUR du destinataire, la RPC ne le renvoie jamais ici).
    // Non-payeur (sans secret mig 0412) : la RPC ne renvoie aucun des deux.
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
        {info.is_delivery && (
          <div className="bg-surface-2 rounded-[14px] px-4 py-2.5 text-center">
            <span className="text-muted text-xs font-bold">
              {t("paidDeliveryInfo", {
                name: info?.captain_name ?? t("captain"),
              })}
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
          {/* Pop-up ouverte ⇒ la carte reste minimale (jamais la même info
              deux fois sur un écran : célébration/détails vivent dans la
              feuille tant qu'elle est affichée). */}
          {!showPopup && <ColigoCelebration variant="verified" />}
          <h1 className="text-foreground mt-2 text-center text-xl font-extrabold">
            {freshPayment ? t("paidPopupTitle") : t("alreadyPaid")}
          </h1>
          <p className="text-muted mt-1 text-center text-sm">
            {freshPayment
              ? t("paidPopupDesc", {
                  merchant: info.merchant?.name ?? "Coligo",
                })
              : t("alreadyPaidDesc", {
                  name: info.captain_name ?? t("captain"),
                })}
          </p>
          <p className="text-foreground mt-4 text-center text-2xl font-black tabular-nums">
            {formatDA(info.total_da)}
          </p>
          <p className="text-subtle mt-0.5 text-center text-xs font-semibold">
            {info.merchant?.name}
          </p>
          {!showPopup && paidDetails}
        </Card>

        {/* Une fois la célébration fermée, l'invité n'avait plus AUCUNE action
            à l'écran. Porte de sortie claire (et découverte de l'app pour
            quelqu'un qui ne l'a pas encore). */}
        <Link
          href="/"
          className="border-border bg-surface text-foreground mt-3 block rounded-[14px] border px-4 py-3 text-center text-sm font-extrabold transition active:scale-[0.98]"
        >
          {t("guestDiscoverCta")}
        </Link>

        {/* Feuille célébration PARTAGÉE — uniquement pour un paiement FRAIS
            (retour Chargily/Stripe ou transition vue en direct), jamais en
            revisite. */}
        {showPopup && (
          <PaidCelebrationSheet
            title={t("paidPopupTitle")}
            desc={t("paidPopupDesc", {
              merchant: info.merchant?.name ?? "Coligo",
            })}
            onClose={() => setPaidPopupClosed(true)}
          >
            {paidDetails}
            <button
              type="button"
              onClick={() => setPaidPopupClosed(true)}
              className="bg-primary-600 hover:bg-primary-700 mt-4 w-full rounded-[14px] px-4 py-3.5 text-base font-extrabold text-white transition active:scale-[0.98]"
            >
              {t("paidPopupClose")}
            </button>
          </PaidCelebrationSheet>
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
            {t("payExpiredDesc", { name: info?.captain_name ?? t("captain") })}
          </p>

          <Link
            href="/"
            className="border-border text-foreground mt-4 flex h-11 w-full items-center justify-center rounded-[13px] border text-sm font-bold"
          >
            {t("goHome")}
          </Link>
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

        {/* RÉCAP ARTICLES — identique au checkout du propriétaire (mig 0427). */}
        {(info.items?.length ?? 0) > 0 && (
          <div className="border-border mt-4 rounded-[16px] border px-4 py-3">
            <p className="text-muted mb-1.5 text-[11px] font-bold tracking-wide uppercase">
              {t("payItemsTitle", { count: info.items!.length })}
            </p>
            {info.items!.map((it, i) => (
              <div
                key={i}
                className="flex items-baseline justify-between py-1 text-[13px]"
              >
                <span className="min-w-0 pe-2 font-semibold">
                  <span className="text-primary-600 me-1 font-extrabold">
                    {it.qty}
                    {it.unit && it.unit !== "piece" ? ` ${it.unit}` : "×"}
                  </span>
                  {it.name}
                </span>
                <span className="shrink-0 font-bold tabular-nums">
                  {formatDA(it.line_total_da)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="bg-surface-2 mt-4 rounded-[16px] px-4 py-3 text-center">
          <p className="text-muted text-[11px] font-bold tracking-wide uppercase">
            {t("payAmountLabel")}
          </p>
          <p className="text-foreground text-3xl font-black tabular-nums">
            {formatDA(info.total_da)}
          </p>
          {/* DÉTAIL avant paiement (mig 0423) : sous-total, frais de service,
              livraison — le payeur sait exactement ce qu'il règle. */}
          {info.subtotal_da != null && (
            <dl className="border-border mt-2.5 space-y-1 border-t pt-2.5 text-[12.5px]">
              <div className="flex items-center justify-between">
                <dt className="text-muted font-semibold">
                  {t("payBreakSubtotal")}
                </dt>
                <dd className="text-foreground font-bold tabular-nums">
                  {formatDA(info.subtotal_da)}
                </dd>
              </div>
              {(info.service_fee_da ?? 0) > 0 && (
                <div className="flex items-center justify-between">
                  <dt className="text-muted font-semibold">
                    {t("payBreakService")}
                  </dt>
                  <dd className="text-foreground font-bold tabular-nums">
                    {formatDA(info.service_fee_da ?? 0)}
                  </dd>
                </div>
              )}
              {(info.delivery_fee_da ?? 0) > 0 && (
                <div className="flex items-center justify-between">
                  <dt className="text-muted font-semibold">
                    {t("payBreakDelivery")}
                  </dt>
                  <dd className="text-foreground font-bold tabular-nums">
                    {formatDA(info.delivery_fee_da ?? 0)}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>

        {/* TRANSPARENCE (mig 0422) : le propriétaire a déjà fixé le mode et
            l'adresse au checkout — l'invité voit ce qu'il paie exactement. */}
        <div className="border-border mt-3 rounded-[14px] border px-4 py-3">
          <p className="text-muted text-[11px] font-bold tracking-wide uppercase">
            {t("payModeTitle", { name: info.captain_name ?? t("captain") })}
          </p>
          <p className="text-foreground mt-1 text-sm font-extrabold">
            {info.is_delivery
              ? info.delivery_mode === "tour"
                ? t("payModeTour")
                : t("payModeExpress")
              : t("payModePickup")}
          </p>
          {info.is_delivery && info.delivery_address_text && (
            <p className="text-muted mt-0.5 text-xs font-medium">
              {info.delivery_address_text}
            </p>
          )}
          {info.is_delivery && (info.delivery_fee_da ?? 0) > 0 && (
            <p className="text-subtle mt-0.5 text-xs font-semibold">
              {t("payModeFee", { fee: formatDA(info.delivery_fee_da ?? 0) })}
            </p>
          )}
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
    // L'invité n'a ni coque client ni barre du bas : l'en-tête de marque est
    // son SEUL repère (où suis-je, à quel titre, comment aller sur Coligo).
    // Il porte la zone sûre du haut ; le contenu reste centré sous lui.
    <div className="bg-surface-2 flex min-h-dvh flex-col">
      <GuestHeader />
      <div className="flex flex-1 items-center justify-center px-4 py-6">
        <div className="w-full max-w-sm">{children}</div>
      </div>
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
