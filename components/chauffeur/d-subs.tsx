"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import {
  Check,
  CreditCard,
  Crown,
  Loader2,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import {
  VIOLET,
  PrimaryBtn,
  GhostBtn,
  Sheet,
  SheetTitle,
} from "@/components/customer/drive/drive-modals";
import { PriorityCard } from "@/components/partner/priority-card";
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
 * Abonnements Drive — AFFICHAGE UNIFIÉ (une seule liste, design « Pass
 * Prioritaire »). Ordre : Prioritaire (produit à part, payé au portefeuille
 * Coligo Pay via PriorityCard) → Gratuit → plans de COMMISSION actifs
 * (Pro/Premium/personnalisés, data-driven 0304, payés en CCP/carte). Le chauffeur
 * ne transmet qu'un CODE de plan ; prix et durée sont imposés par le serveur.
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
  const [paying, setPaying] = useState<ChauffeurPlan | null>(null);
  const [step, setStep] = useState<"choice" | "ccp">("choice");
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

  const subErr = (reason?: string) =>
    reason === "plan_inactive" || reason === "paid_plans_disabled"
      ? tr(
          "Ce plan n'est pas disponible pour le moment.",
          "هذا العرض غير متاح حاليًا."
        )
      : reason === "bad_plan"
        ? tr("Plan introuvable.", "عرض غير موجود.")
        : (reason ?? tr("Échec", "فشل"));

  const payCcpDone = async () => {
    if (!paying || busy) return;
    setBusy(true);
    setError(null);
    const res = await subscribeDrivePlan(paying.code, "ccp");
    setBusy(false);
    if (!res.ok) return setError(subErr(res.error));
    const p = paying;
    setPaying(null);
    setStep("choice");
    setMsg(
      isAr
        ? `تم التصريح بالتحويل — سيبدأ اشتراك ${p.title} بعد موافقة فريق كوليڨو.`
        : `Virement déclaré — l'abonnement ${p.title} démarrera à l'approbation par l'équipe Coligo.`
    );
    load();
  };

  const payCard = async () => {
    if (!paying || busy) return;
    setBusy(true);
    setError(null);
    const res = await subscribeDrivePlan(paying.code, "card");
    setBusy(false);
    if (!res.ok || !res.url)
      return setError(
        subErr(res.error) ??
          tr("Paiement carte indisponible.", "الدفع بالبطاقة غير متاح.")
      );
    window.open(res.url, "_blank");
    setPaying(null);
    setStep("choice");
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
          price={`${fmtDA(p.price_da)} ${tr("DA", "دج")}`}
          per={`/ ${period(p.billing_period)}`}
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
          onChoose={() => {
            setPaying(p);
            setStep("choice");
            setError(null);
          }}
        />
      ))}

      {/* Modale paiement (plans de commission : CCP / carte). */}
      <Sheet
        open={paying != null}
        onClose={() => {
          setPaying(null);
          setStep("choice");
        }}
      >
        <SheetTitle>
          {tr("Payer l'abonnement", "دفع الاشتراك")} {paying?.title} ·{" "}
          {paying ? fmtDA(paying.price_da) : 0} {tr("DA", "دج")} /{" "}
          {paying ? period(paying.billing_period) : ""}
        </SheetTitle>
        {step === "choice" ? (
          <>
            <button
              type="button"
              onClick={() => setStep("ccp")}
              className="mb-2 flex w-full items-center gap-3 rounded-[15px] border-[1.5px] border-[var(--d-line)] p-3 text-start text-[13.5px] font-bold"
            >
              <span
                className="grid size-[38px] shrink-0 place-items-center rounded-[12px]"
                style={{ background: "var(--d-accent)", color: VIOLET }}
              >
                <Wallet className="size-5" />
              </span>
              <span>
                {tr("Virement CCP / BaridiMob", "تحويل CCP / بريدي موب")}
                <small className="mt-0.5 block text-[11px] font-medium text-[var(--d-muted)]">
                  {tr(
                    "Activé après vérification par l'équipe Coligo",
                    "يُفعَّل بعد تحقّق فريق كوليڨو"
                  )}
                </small>
              </span>
            </button>
            <button
              type="button"
              onClick={() => void payCard()}
              className="mb-1 flex w-full items-center gap-3 rounded-[15px] border-[1.5px] border-[var(--d-line)] p-3 text-start text-[13.5px] font-bold"
            >
              <span
                className="grid size-[38px] shrink-0 place-items-center rounded-[12px]"
                style={{ background: "var(--d-accent)", color: VIOLET }}
              >
                <CreditCard className="size-5" />
              </span>
              <span>
                {tr("Carte bancaire · en ligne", "بطاقة بنكية · عبر الإنترنت")}
                <small className="mt-0.5 block text-[11px] font-medium text-[var(--d-muted)]">
                  {tr(
                    "CIB / Edahabia · activation immédiate",
                    "CIB / الذهبية · تفعيل فوري"
                  )}
                </small>
              </span>
            </button>
          </>
        ) : (
          <>
            <p className="mb-1.5 text-[13px] text-[var(--d-muted)]">
              {tr(
                "Effectuez le virement vers le CCP Coligo :",
                "قم بالتحويل إلى حساب كوليڨو CCP:"
              )}
            </p>
            <div
              className="my-2.5 rounded-[15px] border-[1.5px] border-dashed bg-[var(--d-soft)] p-3 text-center"
              style={{ borderColor: VIOLET }}
            >
              <p
                className="text-[19px] font-extrabold tracking-[1px]"
                style={{ color: VIOLET }}
              >
                {fin.ccp.number} — {tr("clé", "المفتاح")} {fin.ccp.key}
              </p>
              <small className="text-[11px] text-[var(--d-muted)]">
                {fin.ccp.name} ·{" "}
                {tr(
                  "mentionnez votre n° de téléphone en référence",
                  "اذكر رقم هاتفك في المرجع"
                )}
              </small>
            </div>
            <PrimaryBtn disabled={busy} onClick={() => void payCcpDone()}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : null}
              {tr("J'ai payé · envoyer le reçu", "دفعت · إرسال الإيصال")}
            </PrimaryBtn>
          </>
        )}
        {error && (
          <p
            className="mt-2 text-center text-xs font-bold"
            style={{ color: "#E5484D" }}
          >
            {error}
          </p>
        )}
        <GhostBtn
          onClick={() => {
            setPaying(null);
            setStep("choice");
          }}
        >
          {tr("Annuler", "إلغاء")}
        </GhostBtn>
      </Sheet>
    </div>
  );
}

/** Carte de plan dans le style « Pass Prioritaire » (en-tête dégradé + avantages). */
function PlanCard({
  current,
  title,
  subtitle,
  icon: Icon,
  header,
  badgeLabel,
  price,
  per,
  advantages,
  onChoose,
}: {
  current: boolean;
  title: string;
  subtitle?: string | null;
  icon: typeof Crown;
  header: string;
  badgeLabel?: string | null;
  price?: string;
  per?: string;
  advantages: string[];
  onChoose?: () => void;
}) {
  const isAr = useLocale() === "ar";
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--d-line)] bg-[var(--d-surface)]">
      <div
        className="flex items-center gap-2 px-4 py-3 text-white"
        style={{ background: header }}
      >
        <Icon className="size-5" />
        <span className="drive-sora font-extrabold">{title}</span>
        {current ? (
          <span className="ms-auto rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">
            {isAr ? "الحالي" : "Actuel"}
          </span>
        ) : (
          badgeLabel && (
            <span className="ms-auto rounded-full bg-white/25 px-2 py-0.5 text-xs font-bold">
              {badgeLabel}
            </span>
          )
        )}
      </div>
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
        {!current && onChoose && (
          <div>
            {price && (
              <p className="text-sm">
                <b className="drive-sora text-lg tracking-[-0.3px]">{price}</b>{" "}
                <span className="text-[var(--d-muted)]">{per}</span>
              </p>
            )}
            <button
              type="button"
              onClick={onChoose}
              className="drive-sora mt-2 w-full rounded-[14px] py-3 text-sm font-bold text-white active:scale-[0.99]"
              style={{ background: VIOLET }}
            >
              {isAr ? `اختيار ${title}` : `Choisir ${title}`}
            </button>
          </div>
        )}
      </div>
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
