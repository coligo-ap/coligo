"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { Check, ChevronDown, Crown, Loader2, Sparkles, X } from "lucide-react";
import { VIOLET } from "@/components/customer/drive/drive-modals";
import { createClient } from "@/lib/supabase/client";
import { openCheckoutKeepPage } from "@/lib/payments/open-checkout";
import { haptic } from "@/lib/native/haptics";
import { PriorityCard } from "@/components/partner/priority-card";
import {
  SubscribeSheet,
  type SubscribeStep,
} from "@/components/partner/subscribe-sheet";
import { PLAN_LABEL } from "./d-ui";
import {
  cancelMyPendingSub,
  getChauffeurFinances,
  getDrivePlansForChauffeur,
  subscribeDrivePlan,
  type ChauffeurFinances,
  type ChauffeurPlan,
} from "@/app/(chauffeur)/actions";

const PERIOD_LABEL: Record<ChauffeurPlan["billing_period"], string> = {
  day: "jour",
  week: "semaine",
  month: "mois",
};
const PERIOD_LABEL_AR: Record<ChauffeurPlan["billing_period"], string> = {
  day: "يوم",
  week: "أسبوع",
  month: "شهر",
};
const pct = (r: number) =>
  `${(r * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
const fmtDA = (n: number) => n.toLocaleString("fr-FR").replace(/ | /g, " ");

/**
 * Abonnements Drive — liste ACCORDÉON (brief « Reste a faire Coligo » §1) :
 * l'offre EN COURS est repliée par défaut (le chauffeur la connaît), les autres
 * offres sont dépliées pour inciter à la découverte. Chaque offre porte UN seul
 * bouton « S'abonner · XX DA ». Le paiement passe par la SubscribeSheet
 * partagée : solde Coligo Pay suffisant → confirmation + activation instantanée
 * (drive_subscribe 'wallet', mig 0382) ; sinon → carte (Chargily direct) ou
 * recharge Coligo Pay pré-sélectionnée (?method=…).
 *
 * ⚠️ Carte : SEUL le webhook Chargily fait foi (?card=success → on POLLE).
 */
export function DSubs({ hideIntro = false }: { hideIntro?: boolean } = {}) {
  const router = useRouter();
  const search = useSearchParams();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const period = (p: ChauffeurPlan["billing_period"]) =>
    (isAr ? PERIOD_LABEL_AR : PERIOD_LABEL)[p];
  const [fin, setFin] = useState<ChauffeurFinances | null>(null);
  const [plans, setPlans] = useState<ChauffeurPlan[]>([]);
  const [walletBal, setWalletBal] = useState<number>(0);
  const [paying, setPaying] = useState<ChauffeurPlan | null>(null);
  const [step, setStep] = useState<SubscribeStep>("confirm");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cardReturn, setCardReturn] = useState<
    "checking" | "confirmed" | "failed" | null
  >(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () => {
    void getChauffeurFinances().then(setFin);
    void getDrivePlansForChauffeur().then(setPlans);
    // Solde Coligo Pay (portefeuille opérateur) — même source que la
    // PriorityCard ; le serveur re-vérifie de toute façon au paiement.
    void createClient()
      .rpc("my_priority_state")
      .then(({ data }) => {
        const b = (data as { wallet_balance?: number } | null)?.wallet_balance;
        setWalletBal(typeof b === "number" ? b : 0);
      });
  };
  useEffect(load, []);

  const labelOf = useMemo(() => {
    const byCode = new Map(plans.map((p) => [p.code, p.title]));
    return (code: string) => byCode.get(code) ?? PLAN_LABEL[code] ?? code;
  }, [plans]);

  useEffect(() => {
    const flag = search.get("card");
    if (!flag) return;
    router.replace("/chauffeur/abonnement");
    if (flag === "failed") return setCardReturn("failed");
    if (flag !== "success") return;
    setCardReturn("checking");
    let tries = 0;
    pollRef.current = setInterval(async () => {
      tries += 1;
      const f = await getChauffeurFinances();
      if (f) setFin(f);
      if (f && !f.pendingSub && f.plan !== "free") {
        setCardReturn("confirmed");
        if (pollRef.current) clearInterval(pollRef.current);
      } else if (tries >= 15) {
        if (pollRef.current) clearInterval(pollRef.current);
        setCardReturn(null);
      }
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!fin) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="size-6 animate-spin" style={{ color: VIOLET }} />
      </div>
    );
  }

  // Jamais de code technique à l'écran : tout code inconnu → message générique.
  const subErr = (reason?: string) =>
    reason === "plan_inactive" || reason === "paid_plans_disabled"
      ? tr(
          "Ce plan n'est pas disponible pour le moment.",
          "هذا العرض غير متاح حاليًا."
        )
      : reason === "bad_plan"
        ? tr("Plan introuvable.", "عرض غير موجود.")
        : reason === "insufficient_wallet"
          ? tr("Solde Coligo Pay insuffisant.", "رصيد كوليڨو باي غير كافٍ.")
          : reason === "already_subscribed"
            ? tr(
                "Vous avez déjà un abonnement actif.",
                "لديك اشتراك نشط بالفعل."
              )
            : tr(
                "Le paiement n'a pas abouti. Réessayez.",
                "لم تكتمل عملية الدفع. أعد المحاولة."
              );

  const openPlan = (p: ChauffeurPlan) => {
    setPaying(p);
    setError(null);
    setStep(walletBal >= p.price_da ? "confirm" : "methods");
  };

  const closeSheet = () => {
    setPaying(null);
    setStep("confirm");
    setError(null);
  };

  // Solde suffisant → paiement Coligo Pay instantané (activation immédiate).
  const payWallet = async () => {
    if (!paying || busy) return;
    setBusy(true);
    setError(null);
    const res = await subscribeDrivePlan(paying.code, "wallet");
    setBusy(false);
    if (!res.ok) {
      if (res.error === "insufficient_wallet") setStep("methods");
      setError(subErr(res.error));
      load();
      return;
    }
    setStep("success");
    haptic("success");
    load();
  };

  const payCard = async () => {
    if (!paying || busy) return;
    setBusy(true);
    setError(null);
    const res = await subscribeDrivePlan(paying.code, "card");
    setBusy(false);
    if (!res.ok || !res.url) return setError(subErr(res.error));
    // Navigateur intégré en APK, nouvel onglet sur le web : l'app reste montée
    // et `load()` ci-dessous polle l'activation (webhook) — jamais de sortie
    // vers un navigateur externe.
    await openCheckoutKeepPage(res.url);
    closeSheet();
    setMsg(
      tr(
        "Confirmation bancaire en cours — la page se met à jour toute seule.",
        "التأكيد البنكي جارٍ — ستُحدَّث الصفحة تلقائيًا."
      )
    );
    load();
  };

  const cancelPending = async () => {
    if (busy) return;
    setBusy(true);
    const res = await cancelMyPendingSub();
    setBusy(false);
    if (!res.ok) setError(res.error ?? tr("Échec", "فشل"));
    else
      setMsg(
        tr(
          "Tentative de paiement annulée — aucun montant n'est dû.",
          "أُلغيت محاولة الدفع — لا مبلغ مستحق."
        )
      );
    load();
  };

  return (
    // `drive-jakarta` : scope requis pour que le thème sombre convertisse les
    // cartes (bg-white → surface sombre) via globals.css — PriorityCard incluse.
    // Le padding bas est fourni par la PAGE (l'historique des abonnements est
    // rendu APRÈS cette liste).
    <div className="drive-jakarta mx-auto max-w-[560px] space-y-3 px-4">
      {/* Intro masquée quand la page fournit déjà le héro partagé (SubsHero). */}
      {!hideIntro && (
        <div>
          <h1 className="drive-sora text-[21px] font-extrabold tracking-[-0.5px]">
            {tr("Mon abonnement", "اشتراكي")}
          </h1>
          <p className="text-sm text-[var(--d-muted)]">
            {tr(
              "Gagnez en visibilité et gardez plus sur chaque course. Changez quand vous voulez.",
              "زد ظهورك واحتفظ بأكثر من كل مشوار. غيّر متى شئت."
            )}
          </p>
        </div>
      )}

      {/* Bannières d'état (retour carte / tentative en attente / message). */}
      {cardReturn === "checking" && (
        <Banner tone="info">
          <Loader2
            className="size-4 shrink-0 animate-spin"
            style={{ color: VIOLET }}
          />
          {tr("Confirmation bancaire en cours…", "التأكيد البنكي جارٍ…")}
        </Banner>
      )}
      {cardReturn === "confirmed" && (
        <Banner tone="ok">
          {isAr
            ? `تم تأكيد الدفع — اشتراك ${labelOf(fin.plan)} نشط.`
            : `Paiement confirmé — abonnement ${labelOf(fin.plan)} actif.`}
        </Banner>
      )}
      {cardReturn === "failed" && (
        <Banner tone="err">
          {tr(
            "Paiement refusé — rien n'a été débité ni activé.",
            "رُفض الدفع — لم يُخصم أي مبلغ ولم يُفعَّل شيء."
          )}
        </Banner>
      )}
      {fin.pendingSub && cardReturn !== "checking" && (
        <Banner tone={fin.pendingSub.method === "ccp" ? "ok" : "warn"}>
          <span>
            {fin.pendingSub.method === "ccp" ? (
              isAr ? (
                <>
                  تحويل {labelOf(fin.pendingSub.plan)} ({fin.pendingSub.amount}{" "}
                  دج) قيد التحقّق — يبدأ الاشتراك بعد موافقة فريق كوليڨو.
                </>
              ) : (
                <>
                  Virement {labelOf(fin.pendingSub.plan)} (
                  {fin.pendingSub.amount} DA) en vérification —
                  l&apos;abonnement démarre à l&apos;approbation par
                  l&apos;équipe Coligo.
                </>
              )
            ) : isAr ? (
              <>
                دفع بالبطاقة {labelOf(fin.pendingSub.plan)} (
                {fin.pendingSub.amount} دج) <b>غير مكتمل</b> — لم يُفعَّل شيء.
              </>
            ) : (
              <>
                Paiement carte {labelOf(fin.pendingSub.plan)} (
                {fin.pendingSub.amount} DA) <b>non finalisé</b> — rien
                n&apos;est activé.
              </>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void cancelPending()}
              className="mt-1.5 flex items-center gap-1 text-[11px] font-extrabold underline"
            >
              <X className="size-3" />{" "}
              {tr("Annuler cette tentative", "إلغاء هذه المحاولة")}
            </button>
          </span>
        </Banner>
      )}
      {msg && <Banner tone="ok">{msg}</Banner>}

      {/* 1) Pass Prioritaire — produit à part (portefeuille Coligo Pay). */}
      <PriorityCard />

      {/* 2) Plan Gratuit (formule de base). */}
      <PlanCard
        current={fin.plan === "free"}
        title={tr("Gratuit", "مجاني")}
        icon={Sparkles}
        header="linear-gradient(90deg,#64748B,#475569)"
        advantages={[
          fin.freeRate <= 0
            ? tr("0 % de commission", "عمولة 0 %")
            : isAr
              ? `عمولة ${pct(fin.freeRate)} على كل مشوار`
              : `Commission ${pct(fin.freeRate)} par course`,
        ]}
      />

      {/* 3) Plans de commission actifs (Pro / Premium / personnalisés). */}
      {plans.map((p) => (
        <PlanCard
          key={p.code}
          current={fin.plan === p.code}
          title={p.title}
          subtitle={p.subtitle}
          icon={Crown}
          header={`linear-gradient(90deg,${p.badge_color || "#5B2EFF"},${VIOLET})`}
          badgeLabel={p.badge_label}
          subscribeLabel={
            isAr
              ? `اشترك · ${fmtDA(p.price_da)} دج / ${period(p.billing_period)}`
              : `S'abonner · ${fmtDA(p.price_da)} DA / ${period(p.billing_period)}`
          }
          advantages={
            p.advantages.length
              ? p.advantages
              : [
                  isAr
                    ? `عمولة ${pct(p.commission_rate)}`
                    : `Commission ${pct(p.commission_rate)}`,
                  ...(p.cashback_rate > 0
                    ? [
                        isAr
                          ? `استرجاع نقدي للزبون ${pct(p.cashback_rate)}`
                          : `Cashback client ${pct(p.cashback_rate)}`,
                      ]
                    : []),
                ]
          }
          onChoose={() => openPlan(p)}
        />
      ))}

      {/* Feuille de paiement partagée (confirm / moyens / succès). */}
      <SubscribeSheet
        offer={
          paying
            ? {
                title: paying.title,
                priceDa: paying.price_da,
                durationDays: paying.duration_days,
                advantages: paying.advantages.length
                  ? paying.advantages
                  : [
                      isAr
                        ? `عمولة ${pct(paying.commission_rate)}`
                        : `Commission ${pct(paying.commission_rate)}`,
                    ],
              }
            : null
        }
        step={step}
        balance={walletBal}
        busy={busy}
        error={error}
        rechargeBase="/chauffeur/recharger"
        onConfirm={() => void payWallet()}
        onCard={() => void payCard()}
        onClose={closeSheet}
      />
    </div>
  );
}

/**
 * Carte de plan ACCORDÉON : l'en-tête (dégradé) replie/déplie la carte.
 * Offre en cours → repliée par défaut (badge « Actuel » visible) ; autres
 * offres → dépliées par défaut (découverte). UN seul bouton « S'abonner ».
 */
function PlanCard({
  current,
  title,
  subtitle,
  icon: Icon,
  header,
  badgeLabel,
  subscribeLabel,
  advantages,
  onChoose,
}: {
  current: boolean;
  title: string;
  subtitle?: string | null;
  icon: typeof Crown;
  header: string;
  badgeLabel?: string | null;
  /** Libellé complet du bouton unique (« S'abonner · 2 000 DA / mois »). */
  subscribeLabel?: string;
  advantages: string[];
  onChoose?: () => void;
}) {
  const isAr = useLocale() === "ar";
  // null = état automatique (replié si offre en cours) ; un tap le fige.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? !current;
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--d-line)] bg-[var(--d-surface)]">
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-start text-white"
        style={{ background: header }}
      >
        <Icon className="size-5 shrink-0" />
        <span className="drive-sora min-w-0 flex-1 truncate font-extrabold">
          {title}
        </span>
        {current ? (
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">
            {isAr ? "الحالي" : "Actuel"}
          </span>
        ) : (
          badgeLabel && (
            <span className="rounded-full bg-white/25 px-2 py-0.5 text-xs font-bold">
              {badgeLabel}
            </span>
          )
        )}
        <ChevronDown
          className="size-4 shrink-0 text-white/80 transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>
      {open && (
        <div className="space-y-3 p-4">
          {subtitle && (
            <p className="text-sm text-[var(--d-muted)]">{subtitle}</p>
          )}
          <ul className="space-y-2 text-sm">
            {advantages.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <Check
                  className="mt-0.5 size-4 shrink-0"
                  style={{ color: VIOLET }}
                />
                <span>{a}</span>
              </li>
            ))}
          </ul>
          {!current && onChoose && subscribeLabel && (
            <button
              type="button"
              onClick={onChoose}
              className="drive-sora w-full rounded-[14px] py-3 text-sm font-bold text-white active:scale-[0.99]"
              style={{ background: VIOLET }}
            >
              {subscribeLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "info" | "ok" | "warn" | "err";
  children: React.ReactNode;
}) {
  const style: Record<"info" | "ok" | "warn" | "err", string> = {
    info: "bg-surface-2 text-foreground",
    ok: "bg-success-50 text-success-700",
    warn: "bg-warning-50 text-warning-700",
    err: "bg-danger-50 text-danger-700",
  };
  return (
    <p
      className={`flex items-center gap-2 rounded-[13px] px-3 py-2.5 text-xs font-bold ${style[tone]}`}
    >
      {children}
    </p>
  );
}
