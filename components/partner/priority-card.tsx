"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import {
  Crown,
  Zap,
  BadgeCheck,
  Wallet,
  ChevronDown,
  LifeBuoy,
  Loader2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { openCheckoutKeepPage } from "@/lib/payments/open-checkout";
import { haptic } from "@/lib/native/haptics";
import { subscribePriorityCard } from "@/components/partner/priority-actions";
import {
  SubscribeSheet,
  type SubscribeStep,
} from "@/components/partner/subscribe-sheet";
import {
  isSupportConfigured,
  openSupportChat,
} from "@/components/support/tawk-chat";

// =============================================================================
// Carte « Abonnement Prioritaire » — commune livreur + chauffeur, ACCORDÉON
// (brief « Reste a faire Coligo » §1) : abo ACTIF → carte repliée par défaut
// (le partenaire la connaît, badge « Actif » visible) ; pas d'abo → dépliée
// avec UN seul bouton « S'abonner · XX DA ». Le paiement passe par la
// SubscribeSheet partagée : solde Coligo Pay suffisant → confirmation +
// activation instantanée ; sinon → carte (Chargily) ou recharge pré-
// sélectionnée. AUCUN code technique (already_subscribed…) n'atteint l'écran.
// =============================================================================

type State = {
  partner: boolean;
  subject_type?: "chauffeur" | "driver";
  enabled?: boolean;
  is_priority?: boolean;
  status?: string;
  period_end?: string | null;
  price_da?: number;
  monthly_da?: number;
  eligible_first_month?: boolean;
  wallet_balance?: number;
};

const fmtDA = (n: number) => n.toLocaleString("fr-FR").replace(/ | /g, " ");

export function PriorityCard() {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<null | "wallet" | "card" | "cancel">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetStep, setSheetStep] = useState<SubscribeStep>("confirm");
  const [sheetErr, setSheetErr] = useState<string | null>(null);
  // null = état automatique (replié si abo actif) ; un tap le fige.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    const sb = createClient();
    const { data } = await sb.rpc("my_priority_state");
    setState((data as State) ?? { partner: false });
  }
  useEffect(() => {
    load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Codes serveur → messages clairs (JAMAIS de code brut à l'écran).
  const prioErr = (code?: string | null) =>
    code === "insufficient_wallet"
      ? tr("Solde Coligo Pay insuffisant.", "رصيد كوليڨو باي غير كافٍ.")
      : code === "already_subscribed"
        ? tr("Vous avez déjà un abonnement actif.", "لديك اشتراك نشط بالفعل.")
        : code === "pass_disabled"
          ? tr(
              "Cette offre n'est pas disponible pour le moment.",
              "هذا العرض غير متاح حاليًا."
            )
          : tr(
              "Le paiement n'a pas abouti. Réessayez.",
              "لم تكتمل عملية الدفع. أعد المحاولة."
            );

  const rechargeHref =
    state?.subject_type === "driver"
      ? "/driver/recharger"
      : "/chauffeur/recharger";
  // Retour Chargily = la page où vit la carte (sous-page Abonnement dans les
  // DEUX espaces) — le poll s'y joue.
  const returnPath =
    state?.subject_type === "driver"
      ? "/driver/abonnement"
      : "/chauffeur/abonnement";

  // Paiement au PORTEFEUILLE (instantané) — depuis la feuille de confirmation.
  async function payWallet() {
    setBusy("wallet");
    setSheetErr(null);
    const sb = createClient();
    const { data, error } = await sb.rpc("priority_subscribe", {
      p_payment_method: "wallet",
    });
    setBusy(null);
    const res = data as { ok?: boolean; error?: string } | null;
    if (error || !res?.ok) {
      if (res?.error === "insufficient_wallet") setSheetStep("methods");
      setSheetErr(prioErr(error ? null : res?.error));
      await load();
      return;
    }
    setSheetStep("success");
    await load();
  }

  // Paiement par CARTE (Chargily, nouvel onglet) → on POLLE l'activation (webhook).
  async function payCard() {
    setBusy("card");
    setSheetErr(null);
    const res = await subscribePriorityCard(returnPath);
    setBusy(null);
    if (!res.ok || !res.url) {
      setSheetErr(prioErr(res.error));
      return;
    }
    // Navigateur intégré en APK, nouvel onglet sur le web : l'app reste montée
    // et le poll ci-dessous détecte l'activation (webhook).
    await openCheckoutKeepPage(res.url);
    setSheetOpen(false);
    setMsg(tr("Confirmation bancaire en cours…", "التأكيد البنكي جارٍ…"));
    setPolling(true);
    let tries = 0;
    pollRef.current = setInterval(async () => {
      tries += 1;
      await load();
      const sb = createClient();
      const { data } = await sb.rpc("my_priority_state");
      const st = data as State | null;
      if ((st?.is_priority || st?.status === "active") && pollRef.current) {
        clearInterval(pollRef.current);
        setPolling(false);
        setMsg(null);
        haptic("success");
      } else if (tries >= 15 && pollRef.current) {
        clearInterval(pollRef.current);
        setPolling(false);
      }
    }, 3000);
  }

  // Résiliation (abo actif) OU annulation d'une tentative en attente.
  async function cancel() {
    setBusy("cancel");
    setMsg(null);
    const sb = createClient();
    await sb.rpc("priority_sub_cancel");
    setBusy(null);
    await load();
  }

  const contactSupport = () =>
    openSupportChat({
      attributes: {
        sujet: "Pass Prioritaire",
        espace: state?.subject_type === "driver" ? "Livreur" : "Chauffeur",
      },
    });

  if (!state || !state.partner) return null;

  const active = Boolean(state.is_priority);
  const pending = !active && state.status === "pending";
  // Pass masqué par le super-admin : on ne montre l'offre que si le partenaire
  // a déjà un abo en cours (pour voir l'échéance / résilier). Sinon → rien.
  if (state.enabled === false && !active && !pending) return null;
  const amount = state.price_da ?? state.monthly_da ?? 0;
  const balance = state.wallet_balance ?? 0;
  const covers = balance >= amount;
  const open = userOpen ?? !active;

  const offer = {
    title: tr("Abonnement Prioritaire", "اشتراك الأولوية"),
    priceDa: amount,
    durationDays: 30,
    advantages: [
      tr(
        "Proposé en premier sur les courses proches",
        "تُعرض أولًا على التوصيلات القريبة"
      ),
      tr(
        "Badge Prioritaire visible par le client",
        "شارة الأولوية مرئية للزبون"
      ),
    ],
    note: state.eligible_first_month
      ? isAr
        ? `الشهر الأول، ثم ${fmtDA(state.monthly_da ?? 0)} دج/شهر`
        : `1er mois, puis ${fmtDA(state.monthly_da ?? 0)} DA/mois`
      : null,
  };

  const openSubscribe = () => {
    setSheetErr(null);
    setSheetStep(covers ? "confirm" : "methods");
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setSheetStep("confirm");
    setSheetErr(null);
  };

  return (
    <div className="border-border overflow-hidden rounded-2xl border bg-white">
      {/* En-tête accordéon : replie/déplie la carte. */}
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-gradient-to-r from-[#5B2EFF] to-[#6C2BD9] px-4 py-3 text-start text-white"
      >
        <Crown className="size-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-extrabold">
          {tr("Abonnement Prioritaire", "اشتراك الأولوية")}
        </span>
        {active && (
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">
            {tr("Actif", "نشط")}
          </span>
        )}
        {pending && (
          <span className="rounded-full bg-white/25 px-2 py-0.5 text-xs font-bold">
            {tr("En attente", "قيد التأكيد")}
          </span>
        )}
        <ChevronDown
          className="size-4 shrink-0 text-white/80 transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>

      {open && (
        <div className="space-y-3 p-4">
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <Zap className="text-primary-600 mt-0.5 size-4 shrink-0" />
              <span>
                {isAr ? (
                  <>
                    <b>تُعرض أولًا</b> على التوصيلات القريبة.
                  </>
                ) : (
                  <>
                    <b>Proposé en premier</b> sur les courses proches.
                  </>
                )}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <BadgeCheck className="text-primary-600 mt-0.5 size-4 shrink-0" />
              <span>
                {isAr ? (
                  <>
                    <b>شارة الأولوية</b> مرئية للزبون.
                  </>
                ) : (
                  <>
                    <b>Badge Prioritaire</b> visible par le client.
                  </>
                )}
              </span>
            </li>
          </ul>

          {active ? (
            <div>
              <p className="text-muted text-sm">
                {tr("Actif jusqu'au", "نشط حتى")}{" "}
                <b className="text-foreground">
                  {state.period_end
                    ? new Date(state.period_end).toLocaleDateString(
                        isAr ? "ar-DZ" : "fr-DZ"
                      )
                    : "—"}
                </b>
                .
              </p>
              <button
                type="button"
                onClick={cancel}
                disabled={busy != null}
                className="text-danger-600 mt-2 text-sm font-semibold hover:underline disabled:opacity-50"
              >
                {busy === "cancel"
                  ? tr("Résiliation…", "جارٍ الإلغاء…")
                  : tr("Résilier", "إلغاء الاشتراك")}
              </button>
            </div>
          ) : pending ? (
            <div className="bg-surface-2 rounded-xl px-3 py-2.5 text-sm">
              <p className="text-muted">
                {tr(
                  "Paiement en cours de confirmation — l'abonnement s'activera automatiquement.",
                  "الدفع قيد التأكيد — سيُفعَّل الاشتراك تلقائيًا."
                )}
              </p>
              <button
                type="button"
                disabled={busy != null}
                onClick={cancel}
                className="text-danger-600 mt-1.5 flex items-center gap-1 text-xs font-extrabold disabled:opacity-50"
              >
                <X className="size-3" />
                {tr("Annuler cette tentative", "إلغاء هذه المحاولة")}
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* Solde Coligo Pay + verdict de couverture. */}
              <div className="bg-surface-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs">
                <Wallet className="text-primary-600 size-4 shrink-0" />
                <span className="text-muted">
                  {tr("Solde Coligo Pay :", "رصيد كوليڨو باي:")}{" "}
                  <b className="text-foreground">
                    {fmtDA(balance)} {tr("DA", "دج")}
                  </b>
                </span>
                <span
                  className={`ms-auto rounded-full px-2 py-0.5 font-bold ${
                    covers
                      ? "bg-success-50 text-success-700"
                      : "bg-warning-50 text-warning-700"
                  }`}
                >
                  {covers
                    ? tr("couvre l’abonnement", "يغطي الاشتراك")
                    : tr("insuffisant", "غير كافٍ")}
                </span>
              </div>

              {/* Bouton UNIQUE — le prix vit dans le bouton (zéro doublon). */}
              <button
                type="button"
                onClick={openSubscribe}
                disabled={busy != null || polling}
                className="bg-primary-600 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                <Crown className="size-4" />
                {isAr
                  ? `اشترك · ${fmtDA(amount)} دج`
                  : `S'abonner · ${fmtDA(amount)} DA`}
              </button>
              {state.eligible_first_month && (
                <p className="text-muted text-center text-xs">
                  {isAr
                    ? `الشهر الأول، ثم ${fmtDA(state.monthly_da ?? 0)} دج/شهر`
                    : `le 1er mois, puis ${fmtDA(state.monthly_da ?? 0)} DA/mois`}
                </p>
              )}
            </div>
          )}

          {(msg || polling) && (
            <p className="text-muted flex items-center gap-2 text-sm font-medium">
              {polling && (
                <Loader2 className="text-primary-600 size-4 shrink-0 animate-spin" />
              )}
              {msg}
            </p>
          )}

          {isSupportConfigured() && (
            <button
              type="button"
              onClick={contactSupport}
              className="text-muted hover:text-primary-700 flex w-full items-center justify-center gap-1.5 text-xs font-semibold"
            >
              <LifeBuoy className="size-3.5" />
              {tr("Contacter le support", "التواصل مع الدعم")}
            </button>
          )}
        </div>
      )}

      {/* Feuille de paiement partagée (confirm / moyens / succès). */}
      <SubscribeSheet
        offer={sheetOpen ? offer : null}
        step={sheetStep}
        balance={balance}
        busy={busy === "wallet" || busy === "card"}
        error={sheetErr}
        rechargeBase={rechargeHref}
        onConfirm={() => void payWallet()}
        onCard={() => void payCard()}
        onClose={closeSheet}
      />
    </div>
  );
}
