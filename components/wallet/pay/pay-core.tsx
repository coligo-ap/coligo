"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ArrowDownLeft, ArrowUpRight, type LucideIcon } from "lucide-react";
import {
  getMyTopupConfig,
  getMyWalletEntries,
  getMyWalletState,
  type MyWalletEntry,
  type MyWalletState,
  type TopupConfig,
} from "@/app/wallet/recharge-actions";
import {
  ENTRY_LABEL,
  FINANCE_LABEL,
  STR,
  type Lang,
  type Owner,
} from "@/components/wallet/operator-recharge-strings";
import {
  BRAND_GO,
  BRAND_RED,
  BRAND_VIOLET,
  SORA,
} from "@/components/shared/partner-ui";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";

/**
 * COLIGO PAY v2 — socle du module « portefeuille » workflow-oriented.
 *
 * Un même module sert les 3 espaces partenaires : chaque écran est une PAGE
 * focalisée (Home / Choix méthode / Carte / CCP / Espèces / Historique /
 * Détail / Paramètres) au lieu d'un seul écran-dashboard. Les pages hôtes
 * fournissent la coque (shell, nav, hub tabs) ; ici tout est en tokens
 * `--d-*` (clair par défaut au :root → OK commerçant ; sombre via
 * `.theme-dark` chauffeur/livreur).
 */

/* ───────────────────────── chemins par espace ───────────────────────── */

/** Préfixe d'espace : "" (commerçant) · "/chauffeur" · "/driver". */
export type PayBase = "" | "/chauffeur" | "/driver";

export function payHref(base: PayBase, sub = ""): string {
  return `${base}/recharger${sub}`;
}

/** « Retirer » : chauffeur/livreur → parcours de retrait Coligo Pay dédié
 *  (demande CCP/BaridiMob, mig 0384) ; commerçant → son canal de versement
 *  EXISTANT (Finances / payout_requests) — pas de doublon de flux. */
export function withdrawHref(base: PayBase): string {
  if (base === "") return "/finances";
  return payHref(base, "/retirer");
}

/* ───────────────────────── i18n locale (FR / AR) ─────────────────────────
   Les espaces partenaires ne montent pas les messages next-intl : on suit la
   langue (useLocale) avec un dictionnaire local, comme operator-recharge. */

export const PAY_STR = {
  fr: {
    walletTitle: "Coligo Pay",
    myWallet: "Mon portefeuille",
    active: "Actif",
    blocked: "Bloqué",
    recharge: "Recharger",
    withdraw: "Retirer",
    history: "Historique",
    historySub: "Toutes vos opérations",
    monthOverview: "Aperçu ce mois",
    seeAll: "Voir tout",
    recentOps: "Dernières opérations",
    noOps: "Aucune opération",
    noOpsSub: "Vos opérations apparaîtront ici.",
    settings: "Paramètres financiers",
    chooseMethod: "Choisissez votre méthode",
    secure: "100% sécurisé",
    needHelp: "Besoin d'aide ?",
    needHelpSub: "Consultez le guide ou contactez le support.",
    howItWorks: "Comment ça fonctionne ?",
    contactSupport: "Contacter le support",
    currentBalance: "Solde actuel",
    availableBalance: "Solde disponible",
    continue: "Continuer",
    securePayNote: "Paiement sécurisé. Vos données sont 100% protégées.",
    checkingPay: "Confirmation du paiement en cours…",
    confirmedTitle: "Recharge confirmée !",
    confirmedSub: "Votre solde a été crédité.",
    failedTitle: "Paiement non abouti",
    failedSub: "Aucun montant n'a été débité. Réessayez.",
    retry: "Réessayer",
    backToWallet: "Retour au portefeuille",
    viewHistory: "Voir l'historique",
    sentTitle: "Demande envoyée",
    sentSub:
      "Vérification sous 24 h. Votre solde sera crédité après validation du montant reçu.",
    stepsTitle: "Étapes à suivre",
    delayTitle: "Délai de traitement",
    delaySub: "Votre solde sera crédité sous 24 h après vérification.",
    opDetail: "Détail de l'opération",
    opType: "Type",
    opDate: "Date",
    opNote: "Note",
    opRef: "Référence",
    opLinkedRef: "Référence liée",
    opImpact: "Impact sur le solde",
    credit: "Crédit",
    debit: "Débit",
    opSupport: "Un souci avec cette opération ? Contacter le support",
    opNotFound: "Opération introuvable.",
    loadMore: "Voir plus d'opérations",
    allKinds: "Tout",
    allPeriods: "Toutes les périodes",
    customDates: "Dates personnalisées…",
    from: "Du",
    to: "Au",
    emptyFilter: "Aucune opération pour ce filtre.",
    retryLoad: "Réessayer",
    loadFail:
      "Impossible de charger votre portefeuille Coligo Pay. Vérifiez votre connexion.",
    finances: "Finances & versements",
    gains: "Gains et relevés",
    subscription: "Abonnement",
    stats: "Statistiques",
    hideBalance: "Masquer le solde",
    hideBalanceSub: "Cache le montant sur l'écran d'accueil",
    ccpPayoutRow: "CCP de versement",
    ccpPayoutSub: "Géré depuis votre compte",
    account: "Compte",
    help: "Aide",
    shortcuts: "Raccourcis",
    withdrawTitle: "Retirer mon argent",
    wMethodLabel: "Méthode de retrait",
    wDestCcp: "N° CCP (avec clé)",
    wDestRip: "RIP BaridiMob",
    wDestName: "Titulaire du compte (optionnel)",
    wDestination: "Destination",
    wAmountLabel: "Montant à retirer",
    wAmountMax: "Max.",
    wReview: "Vérifiez votre demande",
    wReviewNote:
      "Le montant sera débité de votre Coligo Pay au moment du paiement par l'équipe Coligo.",
    wConfirm: "Confirmer le retrait",
    wEdit: "Modifier",
    wPendingTitle: "Retrait en cours",
    wPendingSub: "Votre demande est en traitement par l'équipe Coligo.",
    wPast: "Demandes précédentes",
    wPaid: "Payée",
    wRejected: "Refusée",
  },
  ar: {
    walletTitle: "Coligo Pay",
    myWallet: "محفظتي",
    active: "نشط",
    blocked: "محظور",
    recharge: "شحن",
    withdraw: "سحب",
    history: "السجل",
    historySub: "كل عملياتك",
    monthOverview: "نظرة على هذا الشهر",
    seeAll: "عرض الكل",
    recentOps: "آخر العمليات",
    noOps: "لا توجد عمليات",
    noOpsSub: "ستظهر عملياتك هنا.",
    settings: "الإعدادات المالية",
    chooseMethod: "اختر طريقتك",
    secure: "آمن 100%",
    needHelp: "تحتاج مساعدة؟",
    needHelpSub: "راجع الدليل أو تواصل مع الدعم.",
    howItWorks: "كيف يعمل؟",
    contactSupport: "تواصل مع الدعم",
    currentBalance: "الرصيد الحالي",
    availableBalance: "الرصيد المتاح",
    continue: "متابعة",
    securePayNote: "دفع آمن. بياناتك محمية 100%.",
    checkingPay: "جارٍ تأكيد الدفع…",
    confirmedTitle: "تم تأكيد الشحن!",
    confirmedSub: "تمت إضافة الرصيد إلى محفظتك.",
    failedTitle: "لم يتم الدفع",
    failedSub: "لم يُخصم أي مبلغ. حاول مجددًا.",
    retry: "أعد المحاولة",
    backToWallet: "العودة إلى المحفظة",
    viewHistory: "عرض السجل",
    sentTitle: "تم إرسال الطلب",
    sentSub: "التحقق خلال 24 ساعة. يُضاف رصيدك بعد التأكد من المبلغ المُستلَم.",
    stepsTitle: "الخطوات",
    delayTitle: "مدة المعالجة",
    delaySub: "يُضاف رصيدك خلال 24 ساعة بعد التحقق.",
    opDetail: "تفاصيل العملية",
    opType: "النوع",
    opDate: "التاريخ",
    opNote: "ملاحظة",
    opRef: "المرجع",
    opLinkedRef: "مرجع مرتبط",
    opImpact: "الأثر على الرصيد",
    credit: "دائن",
    debit: "مدين",
    opSupport: "مشكلة في هذه العملية؟ تواصل مع الدعم",
    opNotFound: "العملية غير موجودة.",
    loadMore: "عرض المزيد",
    allKinds: "الكل",
    allPeriods: "كل الفترات",
    customDates: "فترة مخصّصة…",
    from: "من",
    to: "إلى",
    emptyFilter: "لا عمليات لهذا التصفية.",
    retryLoad: "إعادة المحاولة",
    loadFail: "تعذّر تحميل محفظتك. تحقّق من اتصالك.",
    finances: "المالية والتحويلات",
    gains: "الأرباح والكشوف",
    subscription: "الاشتراك",
    stats: "الإحصائيات",
    hideBalance: "إخفاء الرصيد",
    hideBalanceSub: "يخفي المبلغ في الشاشة الرئيسية",
    ccpPayoutRow: "حساب CCP للتحويل",
    ccpPayoutSub: "يُدار من حسابك",
    account: "الحساب",
    help: "مساعدة",
    shortcuts: "اختصارات",
    withdrawTitle: "سحب أموالي",
    wMethodLabel: "طريقة السحب",
    wDestCcp: "رقم CCP (مع المفتاح)",
    wDestRip: "RIP بريدي موب",
    wDestName: "صاحب الحساب (اختياري)",
    wDestination: "الوجهة",
    wAmountLabel: "المبلغ المراد سحبه",
    wAmountMax: "الحد الأقصى",
    wReview: "راجع طلبك",
    wReviewNote: "يُخصم المبلغ من محفظتك عند الدفع من طرف فريق Coligo.",
    wConfirm: "تأكيد السحب",
    wEdit: "تعديل",
    wPendingTitle: "سحب قيد المعالجة",
    wPendingSub: "طلبك قيد المعالجة من طرف فريق Coligo.",
    wPast: "الطلبات السابقة",
    wPaid: "مدفوعة",
    wRejected: "مرفوضة",
  },
} as const;

export function usePayLang() {
  const locale = useLocale();
  const lang: Lang = locale === "ar" ? "ar" : "fr";
  return {
    lang,
    t: PAY_STR[lang],
    /** Dictionnaire historique (méthodes, notes, étapes CCP…). */
    tr: STR[lang],
    dir: lang === "ar" ? ("rtl" as const) : ("ltr" as const),
  };
}

/* ───────────────────────── formatage ───────────────────────── */

/** Groupement des milliers manuel (cohérent SSR/CSR, jamais Intl). */
export function groupNum(n: number): string {
  return Math.abs(Math.round(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function fmtDay(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-DZ" : "fr-DZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Algiers",
  });
}

export function fmtDayTime(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-DZ" : "fr-DZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Algiers",
  });
}

/* ───────────────────────── classification des écritures ───────────────────────── */

export type OpsKind =
  | "recharge"
  | "vente"
  | "commission"
  | "cashback"
  | "autre";

/** Classification TRAÇABLE d'une écriture (même logique que l'ancien écran). */
export function kindOf(e: MyWalletEntry): OpsKind {
  if (e.type.startsWith("topup")) return "recharge";
  const key = e.type === "finance_mirror" ? (e.note ?? "") : e.type;
  if (key === "sale" || key === "delivery_revenue") return "vente";
  if (
    key.includes("commission") ||
    key === "service_fee" ||
    key === "cod_settle"
  )
    return "commission";
  if (key === "wallet_redemption" || key === "cashback") return "cashback";
  return "autre";
}

export const KIND_LABEL: Record<OpsKind, [string, string]> = {
  recharge: ["Recharges", "الشحن"],
  vente: ["Ventes en ligne", "مبيعات عبر الإنترنت"],
  commission: ["Commissions", "العمولات"],
  cashback: ["Cashback", "كاش باك"],
  autre: ["Autres", "أخرى"],
};

/** Libellé humain d'une écriture (recharge / commission / vente / abonnement…). */
export function entryLabel(e: MyWalletEntry, lang: Lang): string {
  if (e.type === "finance_mirror")
    return FINANCE_LABEL[lang][e.note ?? ""] ?? e.note ?? e.type;
  // `fee_debit` sert À LA FOIS les commissions ET les frais d'ABONNEMENT / de
  // PASS (même type SQL, mig 0382 / 0210 / 0309). Le `note` porte le vrai
  // libellé (« Abonnement Drive … », « Abonnement Prioritaire ») → on l'affiche
  // pour ne JAMAIS étiqueter un abonnement / un pass comme « Commission »
  // (malentendu partenaire signalé). Repli générique si aucune note.
  if (e.type === "fee_debit" && e.note && e.note.trim())
    return feeDebitLabel(e.note, lang);
  return ENTRY_LABEL[lang][e.type] ?? e.type;
}

/** Précise la nature d'un débit `fee_debit` à partir de sa note (stockée en FR).
 *  Pass Prioritaire, abonnement Drive et vraie commission portent le MÊME type
 *  SQL — seule la note les distingue. */
function feeDebitLabel(note: string, lang: Lang): string {
  const n = note.trim();
  if (/prioritaire/i.test(n))
    return lang === "ar" ? "الممر الأولوي" : "Pass Prioritaire";
  if (/^abonnement\s+drive/i.test(n))
    return lang === "ar" ? n.replace(/^abonnement/i, "اشتراك") : n;
  if (/commission/i.test(n)) return lang === "ar" ? "عمولة" : "Commission";
  return n;
}

/* ───────────────────────── cache mémoire (par onglet) ─────────────────────────
   Réaffichage INSTANTANÉ entre les pages du module (règle « cache d'abord,
   réseau ensuite ») : mémoire volatile uniquement (jamais localStorage — donnée
   financière), revalidée en silence à chaque montage + reprise premier plan.
   Les RPC sont scopées auth.uid() : une réponse fraîche corrige toujours. */

type PayData = {
  state: MyWalletState | null;
  entries: MyWalletEntry[];
  entriesLimit: number;
  config: TopupConfig | null;
};

let payCache: PayData | null = null;

export function usePayWallet(
  opts: { entriesLimit?: number; withConfig?: boolean } = {}
) {
  const wantLimit = opts.entriesLimit ?? 20;
  const wantConfig = opts.withConfig ?? false;
  const [data, setData] = useState<PayData | null>(payCache);
  const [loading, setLoading] = useState(!payCache?.state);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(
    async (limitOverride?: number) => {
      if (inFlight.current) return payCache;
      inFlight.current = true;
      const limit = Math.max(
        limitOverride ?? wantLimit,
        payCache?.entriesLimit ?? 0
      );
      try {
        const [state, entries, config] = await Promise.all([
          getMyWalletState(),
          getMyWalletEntries(limit),
          wantConfig && !payCache?.config
            ? getMyTopupConfig()
            : Promise.resolve(payCache?.config ?? null),
        ]);
        payCache = { state, entries, entriesLimit: limit, config };
        setData(payCache);
        setFailed(!state);
        return payCache;
      } catch {
        // Réseau/auth KO : jamais de spinner infini — écran « Réessayer ».
        setFailed(!payCache?.state);
        return payCache;
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [wantLimit, wantConfig]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reprise au premier plan : solde/opérations re-synchronisés en silence.
  useResumeResync(() => {
    void refresh();
  });

  return {
    state: data?.state ?? null,
    entries: data?.entries ?? [],
    config: data?.config ?? null,
    loading,
    failed,
    refresh,
  };
}

/** Invalide le cache (après une recharge confirmée, une demande envoyée…). */
export function invalidatePayCache(): void {
  payCache = null;
}

/* ───────────────────────── masquer le solde (partagé) ───────────────────────── */

const HIDE_KEY = "coligo_pay_hide";

export function useHideBalance() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(HIDE_KEY) === "1");
    } catch {
      /* localStorage indisponible */
    }
  }, []);
  const toggle = () =>
    setHidden((v) => {
      const n = !v;
      try {
        window.localStorage.setItem(HIDE_KEY, n ? "1" : "0");
      } catch {
        /* localStorage indisponible */
      }
      return n;
    });
  return { hidden, toggle };
}

/* ───────────────────────── owner ───────────────────────── */

export function ownerOf(state: MyWalletState | null): Owner {
  const o = state?.ownerType;
  return o === "chauffeur" || o === "merchant" || o === "partner"
    ? o
    : "driver";
}

/* ───────────────────────── primitives d'écran ───────────────────────── */

/** Enveloppe commune des écrans du module (direction + largeur mobile-first). */
export function PayScreen({
  dir,
  children,
}: {
  dir: "ltr" | "rtl";
  children: React.ReactNode;
}) {
  return (
    <section dir={dir} className="mx-auto w-full max-w-[560px]">
      {children}
    </section>
  );
}

/** Carte standard du module (surface, bord, rayon maquette). */
export function PayCard({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-[18px] border border-[var(--d-line)] bg-[var(--d-surface)] ${className}`}
    >
      {children}
    </div>
  );
}

/** Montant signé coloré (crédit vert / débit rouge), groupé manuellement. */
export function PayAmount({
  amountDa,
  size = 13.5,
}: {
  amountDa: number;
  size?: number;
}) {
  const credit = amountDa >= 0;
  return (
    <span
      className="font-extrabold whitespace-nowrap"
      style={{
        color: credit ? BRAND_GO : BRAND_RED,
        fontSize: size,
        fontFamily: SORA,
      }}
    >
      {credit ? "+" : "−"}
      {groupNum(amountDa)} DA
    </span>
  );
}

/** Ligne d'opération (icône directionnelle + libellé + date + montant). */
export function PayEntryRow({
  entry,
  href,
  lang,
}: {
  entry: MyWalletEntry;
  href: string;
  lang: Lang;
}) {
  const credit = entry.amountDa >= 0;
  const Icon: LucideIcon = credit ? ArrowDownLeft : ArrowUpRight;
  return (
    <Link
      href={href}
      prefetch
      className="flex w-full items-center gap-3 border-b border-[var(--d-line)] px-3.5 py-3 last:border-b-0"
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-full"
        style={{
          background: credit ? "rgba(22,179,100,.12)" : "rgba(229,72,77,.10)",
          color: credit ? BRAND_GO : BRAND_RED,
        }}
      >
        <Icon className="size-4 rtl:-scale-x-100" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-[var(--d-ink)]">
          {entryLabel(entry, lang)}
        </span>
        <span className="block text-[11px] font-medium text-[var(--d-muted)]">
          {fmtDay(entry.createdAt, lang)}
        </span>
      </span>
      <PayAmount amountDa={entry.amountDa} />
    </Link>
  );
}

/** Grande action primaire violette (pleine largeur). */
export function PayPrimaryButton({
  children,
  onClick,
  disabled,
  href,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  href?: string;
}) {
  const cls =
    "flex w-full items-center justify-center gap-2 rounded-[14px] py-3.5 text-[14px] font-extrabold text-white disabled:opacity-60";
  const style = {
    background: BRAND_VIOLET,
    boxShadow: "0 10px 24px -10px rgba(108,43,217,.55)",
    fontFamily: SORA,
  };
  if (href) {
    return (
      <Link href={href} prefetch className={cls} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      style={style}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/** Squelette d'écran (cache froid) — jamais d'écran blanc. */
export function PaySkeleton({ hero = true }: { hero?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-[560px] animate-pulse space-y-3">
      {hero && <div className="h-[150px] rounded-[22px] bg-[var(--d-soft)]" />}
      <div className="h-[74px] rounded-[18px] bg-[var(--d-soft)]" />
      <div className="h-[160px] rounded-[18px] bg-[var(--d-soft)]" />
    </div>
  );
}

/** Écran d'échec de chargement avec « Réessayer » (jamais d'écran blanc). */
export function PayLoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = usePayLang();
  return (
    <div className="mx-auto w-full max-w-[560px] rounded-[18px] border border-[var(--d-line)] bg-[var(--d-surface)] px-5 py-8 text-center">
      <p className="mb-4 text-[13.5px] font-bold text-[var(--d-ink)]">
        {t.loadFail}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-[12px] px-5 py-2.5 text-[13px] font-extrabold text-white"
        style={{ background: BRAND_VIOLET }}
      >
        {t.retryLoad}
      </button>
    </div>
  );
}
