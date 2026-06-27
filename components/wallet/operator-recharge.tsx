"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { getPosition } from "@/lib/native/geolocation";
import { geocodeCommune } from "@/lib/geo/geocode";
import {
  NAV_APPS,
  getNavPref,
  openNav,
  setNavPref,
  type NavApp,
} from "@/lib/drive/nav";
import {
  RechargePointsMap,
  type MapPoint,
} from "@/components/wallet/recharge-points-map";
import {
  createOperatorTopupCheckout,
  getMyTopupConfig,
  getMyWalletEntries,
  getMyWalletState,
  requestOperatorManualTopup,
  type MyWalletEntry,
  type MyWalletState,
  type TopupConfig,
} from "@/app/wallet/recharge-actions";
import { RECHARGE_STYLE } from "@/components/wallet/operator-recharge.style";
import {
  isSupportConfigured,
  openSupportChat,
} from "@/components/support/tawk-chat";

/* ───────────────────────── i18n local (FR / AR) ─────────────────────────
   Dictionnaire autonome : les espaces partenaires (livreur / chauffeur /
   commerçant) ne montent pas les messages next-intl. On suit néanmoins la
   langue de l'app (useLocale) et on bascule RTL en arabe « comme le reste ». */
type Lang = "fr" | "ar";
type Owner = "driver" | "chauffeur" | "merchant" | "partner";

const OWNER_BADGE: Record<Lang, Record<Owner, string>> = {
  fr: {
    driver: "Livreur",
    chauffeur: "Chauffeur",
    merchant: "Commerçant",
    partner: "Agent Coligo Pay",
  },
  ar: {
    driver: "موصِّل",
    chauffeur: "سائق",
    merchant: "تاجر",
    partner: "وكيل Coligo Pay",
  },
};

const OWNER_CTX: Record<Lang, Record<Owner, string>> = {
  fr: {
    driver:
      "Un solde est nécessaire pour accepter des livraisons. La commission Coligo est prélevée sur votre solde à chaque livraison terminée.",
    chauffeur:
      "Un solde est nécessaire pour accepter des courses. La commission Coligo est prélevée sur votre solde à chaque course terminée.",
    merchant:
      "Un solde est nécessaire pour recevoir des commandes. La commission Coligo est prélevée sur votre solde à chaque commande terminée.",
    partner:
      "Un solde est nécessaire pour vendre des recharges. La commission Coligo est prélevée sur votre solde à chaque opération.",
  },
  ar: {
    driver:
      "يلزم وجود رصيد لقبول عمليات التوصيل. تُقتطع عمولة Coligo من رصيدك عند كل عملية توصيل منتهية.",
    chauffeur:
      "يلزم وجود رصيد لقبول الرحلات. تُقتطع عمولة Coligo من رصيدك عند كل رحلة منتهية.",
    merchant:
      "يلزم وجود رصيد لاستقبال الطلبات. تُقتطع عمولة Coligo من رصيدك عند كل طلب منتهٍ.",
    partner:
      "يلزم وجود رصيد لبيع التعبئات. تُقتطع عمولة Coligo من رصيدك عند كل عملية.",
  },
};

const ENTRY_LABEL: Record<Lang, Record<string, string>> = {
  fr: {
    topup_chargily: "Recharge carte",
    topup_manual: "Recharge validée",
    topup_partner: "Recharge chez un agent",
    recharge_sale: "Revente de crédit",
    bonus: "Bonus",
    fee_debit: "Commission",
    service_fee: "Frais de service",
    cod_settle: "Régularisation",
    adjustment: "Ajustement",
  },
  ar: {
    topup_chargily: "شحن بالبطاقة",
    topup_manual: "شحن مُصادق عليه",
    topup_partner: "شحن لدى وكيل",
    recharge_sale: "بيع رصيد",
    bonus: "مكافأة",
    fee_debit: "عمولة",
    service_fee: "رسوم الخدمة",
    cod_settle: "تسوية",
    adjustment: "تعديل",
  },
};

// Libellés des opérations FINANCE reflétées dans la Coligo Pay commerçant
// (écritures `finance_mirror` : le `note` porte le type finance sous-jacent).
const FINANCE_LABEL: Record<Lang, Record<string, string>> = {
  fr: {
    sale: "Vente (commande)",
    commission: "Commission Coligo",
    service_fee: "Frais de service",
    tour_delivery_commission: "Commission livraison",
    payout: "Versement",
    adjustment: "Ajustement",
    wallet_redemption: "Paiement par cashback",
    cashback: "Cashback",
  },
  ar: {
    sale: "بيع (طلب)",
    commission: "عمولة Coligo",
    service_fee: "رسوم الخدمة",
    tour_delivery_commission: "عمولة التوصيل",
    payout: "تحويل",
    adjustment: "تعديل",
    wallet_redemption: "دفع عبر الكاش باك",
    cashback: "كاش باك",
  },
};

const STR = {
  fr: {
    title: "Mon portefeuille",
    balanceLabel: "Solde du portefeuille",
    rechargeTitle: "Recharger mon solde",
    mCard: "Carte",
    mCardDelay: "Instantané",
    fast: "Rapide",
    mCcp: "Virement",
    mCcpDelay: "CCP · 24h",
    mCash: "Espèces",
    mCashDelay: "Chez un agent",
    amountLabel: "Montant à recharger",
    otherAmount: "Autre montant en DA (min. 100)",
    payCard: "Payer par carte",
    cardNote:
      "Paiement Edahabia / CIB via Chargily Pay. Solde crédité instantanément après confirmation.",
    checking: "Confirmation du paiement en cours…",
    confirmed: "Recharge confirmée !",
    failed: "Paiement non abouti — réessayez.",
    step1: "Virez le montant vers le CCP de Coligo (ci-dessous)",
    step2: "Saisissez le montant exact envoyé",
    step3: "Joignez la preuve (reçu ou confirmation de virement)",
    step4: "L'équipe Coligo vérifie et crédite votre solde",
    ccpRef: "Référence : votre numéro de téléphone",
    ccpUnset: "CCP non configuré — contactez le support",
    bankLabel: "Compte bancaire (virement)",
    bankRibRef: "RIB · référence : votre numéro de téléphone",
    copied: "Copié",
    amountSent: "Montant envoyé en DA",
    addProof: "Ajouter la preuve de virement",
    proofHint: "Reçu CCP / BaridiMob · capture d'écran ou photo",
    proofAdded: "Preuve ajoutée ✓",
    proofReplace: "· touchez pour remplacer",
    sendRequest: "Envoyer la demande",
    ccpNote:
      "Vérifiée par l'équipe Coligo sous 24 h. Votre solde est crédité après validation du montant reçu.",
    sentMsg:
      "Demande envoyée · en vérification (24 h). Votre solde sera crédité après validation.",
    cashTitle: "Recharger en espèces chez un agent Coligo Pay",
    cityPlaceholder: "Ville ou commune",
    useMyPos: "Utiliser ma position",
    list: "Liste",
    map: "Carte",
    locating: "Localisation…",
    searching: "Recherche…",
    search: "Chercher",
    around: "Autour de vous",
    itinerary: "Itinéraire",
    openNow: "Ouvert",
    closedNow: "Fermé",
    tapPoint: "Touchez un point sur la carte pour voir ses informations.",
    emptyTitle: "Aucun agent à proximité",
    emptySub: "Cherchez une autre ville, ou rechargez par carte / virement.",
    cityNotFound: "Ville introuvable. Vérifiez l'orthographe.",
    cashNote:
      "Remettez l'espèce à l'agent : votre solde est crédité immédiatement.",
    opsTitle: "Dernières opérations",
    minAmount: "Montant minimum : 100 DA.",
    payUnavailable: "Paiement carte indisponible.",
    uploadFail: "Téléversement échoué",
    requestFail: "Échec de la demande.",
    genericErr: "Une erreur est survenue.",
    openWith: "Ouvrir l'itinéraire avec",
    openWithSub: "Votre choix sera mémorisé pour la prochaine fois.",
    cancel: "Annuler",
    chargily: "Chargily",
    support: "Un souci de recharge ou de paiement ? Contacter le support",
  },
  ar: {
    title: "محفظتي",
    balanceLabel: "رصيد المحفظة",
    rechargeTitle: "إعادة شحن رصيدي",
    mCard: "بطاقة",
    mCardDelay: "فوري",
    fast: "سريع",
    mCcp: "تحويل",
    mCcpDelay: "CCP · 24س",
    mCash: "نقدًا",
    mCashDelay: "لدى وكيل",
    amountLabel: "المبلغ المراد شحنه",
    otherAmount: "مبلغ آخر بالدينار (100 كحد أدنى)",
    payCard: "الدفع بالبطاقة",
    cardNote:
      "الدفع عبر الذهبية / CIB بواسطة Chargily Pay. يُضاف الرصيد فورًا بعد التأكيد.",
    checking: "جارٍ تأكيد الدفع…",
    confirmed: "تم تأكيد الشحن!",
    failed: "لم يتم الدفع — حاول مجددًا.",
    step1: "حوّل المبلغ إلى حساب CCP الخاص بـ Coligo (أدناه)",
    step2: "أدخل المبلغ المُرسل بالضبط",
    step3: "أرفق الإثبات (وصل أو تأكيد التحويل)",
    step4: "يتحقق فريق Coligo ويشحن رصيدك",
    ccpRef: "المرجع: رقم هاتفك",
    ccpUnset: "حساب CCP غير مُعدّ — تواصل مع الدعم",
    bankLabel: "حساب بنكي (تحويل)",
    bankRibRef: "RIB · المرجع: رقم هاتفك",
    copied: "تم النسخ",
    amountSent: "المبلغ المُرسل بالدينار",
    addProof: "أضف إثبات التحويل",
    proofHint: "وصل CCP / BaridiMob · لقطة شاشة أو صورة",
    proofAdded: "تمت إضافة الإثبات ✓",
    proofReplace: "· المس للاستبدال",
    sendRequest: "إرسال الطلب",
    ccpNote:
      "يتحقق فريق Coligo خلال 24 ساعة. يُضاف رصيدك بعد التأكد من المبلغ المُستلَم.",
    sentMsg:
      "تم إرسال الطلب · قيد التحقق (24 ساعة). سيُضاف رصيدك بعد المصادقة.",
    cashTitle: "اشحن نقدًا لدى وكيل Coligo Pay",
    cityPlaceholder: "مدينة أو بلدية",
    useMyPos: "استخدم موقعي",
    list: "قائمة",
    map: "خريطة",
    locating: "تحديد الموقع…",
    searching: "بحث…",
    search: "بحث",
    around: "حولك",
    itinerary: "المسار",
    openNow: "مفتوح",
    closedNow: "مغلق",
    tapPoint: "المس نقطة على الخريطة لعرض معلوماتها.",
    emptyTitle: "لا يوجد وكيل قريب",
    emptySub: "ابحث عن مدينة أخرى، أو اشحن بالبطاقة / التحويل.",
    cityNotFound: "المدينة غير موجودة. تحقق من الكتابة.",
    cashNote: "سلّم النقود للوكيل: يُضاف رصيدك فورًا.",
    opsTitle: "آخر العمليات",
    minAmount: "الحد الأدنى للمبلغ: 100 دج.",
    payUnavailable: "الدفع بالبطاقة غير متاح.",
    uploadFail: "فشل الرفع",
    requestFail: "فشل الطلب.",
    genericErr: "حدث خطأ.",
    openWith: "افتح المسار باستخدام",
    openWithSub: "سيُحفظ اختيارك للمرة القادمة.",
    cancel: "إلغاء",
    chargily: "Chargily",
    support: "مشكلة في الشحن أو الدفع؟ تواصل مع الدعم",
  },
} as const;

/** Groupement des milliers manuel (cohérent SSR/CSR, cf. formatDA). */
function groupNum(n: number): string {
  return Math.abs(Math.round(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function fmtDistance(km: number): string {
  if (!Number.isFinite(km)) return "";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace(".", ",")} km`;
}

/** Ouvert/fermé best-effort à partir d'un champ horaires en texte libre. */
function openStatus(hours: string | null): boolean | null {
  if (!hours) return null;
  const tokens = [...hours.matchAll(/(\d{1,2})\s*(?:[h:]\s*(\d{2}))?/g)]
    .map((m) => {
      const h = Number(m[1]);
      const min = m[2] ? Number(m[2]) : 0;
      return Number.isFinite(h) && h <= 24 ? h + min / 60 : null;
    })
    .filter((v): v is number => v != null);
  if (tokens.length < 2) return null;
  const open = tokens[0];
  const close = tokens[1];
  const d = new Date();
  const now = ((d.getUTCHours() + 1) % 24) + d.getUTCMinutes() / 60; // Alger UTC+1
  if (close > open) return now >= open && now < close;
  return now >= open || now < close;
}

type Method = "card" | "ccp" | "cash";

/* ─────────────────────────── icônes (SVG maquette) ─────────────────────── */
const Ico = {
  wallet: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M2 10h20M16 14h3" />
    </svg>
  ),
  card: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M2 10h20" />
    </svg>
  ),
  bank: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6" />
    </svg>
  ),
  cash: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 9l2-5h14l2 5M3 9h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 13h6" />
    </svg>
  ),
  info: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  ),
  check: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  clock: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  copy: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  ),
  image: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 15l5-5 4 4 3-3 6 6" />
      <circle cx="8.5" cy="8.5" r="1.5" />
    </svg>
  ),
  send: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />
    </svg>
  ),
  pin: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  ),
  search: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  ),
  liste: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  ),
  mapIco: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6 3 4v14l6 2 6-2 6 2V6l-6-2-6 2zM9 4v14M15 6v14" />
    </svg>
  ),
  store: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 9l2-5h14l2 5M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M9 20v-6h6v6" />
    </svg>
  ),
  spinner: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2.4"
      strokeLinecap="round"
      className="cgw-spin"
    >
      <path d="M21 12a9 9 0 1 1-6.2-8.5" />
    </svg>
  ),
  up: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  ),
  down: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  ),
};

/**
 * Page « Mon portefeuille » — recharge du portefeuille opérateur (livreur /
 * chauffeur / commerçant / partenaire), reproduction fidèle de la maquette.
 * Solde (HERO), recharge Carte (Chargily) / Virement CCP (preuve) / Espèces
 * (agents Coligo Pay), et dernières opérations. Réutilisable dans tous les
 * espaces (la barre de navigation du bas reste celle du shell hôte).
 */
export function OperatorRecharge({
  compact = false,
  title,
}: {
  /** Mode encart (portail partenaire) : masque le HERO, le titre de page et
   *  l'historique — le portail affiche déjà son propre solde et historique. */
  compact?: boolean;
  /** Titre de section personnalisé (sinon « Recharger mon solde »). */
  title?: string;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const locale = useLocale();
  const lang: Lang = locale === "ar" ? "ar" : "fr";
  const t = STR[lang];
  const dir = lang === "ar" ? "rtl" : "ltr";

  const [state, setState] = useState<MyWalletState | null>(null);
  const [entries, setEntries] = useState<MyWalletEntry[]>([]);
  const [config, setConfig] = useState<TopupConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const [method, setMethod] = useState<Method>("card");
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<"ccp" | "rib" | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [topupReturn, setTopupReturn] = useState<
    "checking" | "confirmed" | "failed" | null
  >(null);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittingRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [st, en] = await Promise.all([
        getMyWalletState(),
        getMyWalletEntries(),
      ]);
      setState(st);
      setEntries(en);
      return { st, en };
    } catch {
      // Réseau/auth KO : on N'enferme PAS l'écran dans un spinner infini.
      return { st: null, en: [] as MyWalletEntry[] };
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void getMyTopupConfig().then(setConfig);
  }, [refresh]);

  // Retour Chargily : on NE croit JAMAIS la redirection ?topup=success (forgeable).
  // La SEULE preuve est l'écriture topup_chargily posée par le webhook (HMAC,
  // idempotente). On attend qu'elle apparaisse après le clic « Payer ».
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
      setTopupReturn("failed");
      return;
    }
    if (flag !== "success") return;
    setTopupReturn("checking");
    const since = startedAt > 0 ? startedAt - 90_000 : Date.now() - 600_000;
    const credited = (en: MyWalletEntry[]) =>
      en.some(
        (e) =>
          e.type === "topup_chargily" &&
          new Date(e.createdAt).getTime() >= since
      );
    let tries = 0;
    const tick = async () => {
      tries += 1;
      const { en } = await refresh();
      if (credited(en)) {
        setTopupReturn("confirmed");
        if (pollRef.current) clearInterval(pollRef.current);
      } else if (tries >= 20) {
        if (pollRef.current) clearInterval(pollRef.current);
        setTopupReturn(null);
      }
    };
    void tick();
    pollRef.current = setInterval(() => void tick(), 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const amt = Number(amount);
  const amtValid = Number.isFinite(amt) && amt >= 100;

  const payCard = async () => {
    if (!amtValid || busy || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await createOperatorTopupCheckout(amt, pathname);
      if (!res.ok || !res.url) {
        setErr(res.error ?? t.payUnavailable);
        return;
      }
      try {
        window.localStorage.setItem(
          "coligo_op_topup_started",
          String(Date.now())
        );
      } catch {
        /* localStorage indisponible */
      }
      window.location.href = res.url;
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  const submitManual = async () => {
    if (!amtValid || !file || !state || busy || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const supabase = createClient();
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${state.walletId}/${crypto.randomUUID()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from("wallet-proofs")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        setErr(`${t.uploadFail} : ${upErr.message}`);
        return;
      }
      const res = await requestOperatorManualTopup({
        method: "virement",
        amountDa: amt,
        proofPath: path,
      });
      if (!res.ok) {
        setErr(res.error ?? t.requestFail);
        return;
      }
      setFile(null);
      setAmount("");
      setMsg(t.sentMsg);
      void refresh();
    } catch {
      setErr(t.genericErr);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  const copyVal = async (key: "ccp" | "rib", text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard indisponible */
    }
  };

  const owner: Owner = ((): Owner => {
    const o = state?.ownerType;
    return o === "chauffeur" || o === "merchant" || o === "partner"
      ? o
      : "driver";
  })();
  const presets = config?.presets ?? [500, 1000, 2000, 5000];

  if (loading) {
    return (
      <section className="cgw" dir={dir}>
        <style>{RECHARGE_STYLE}</style>
        <div className="cgw-load">
          <span className="cgw-load-ic">{Ico.spinner}</span>
        </div>
      </section>
    );
  }
  // Jamais d'écran BLANC : si l'état du portefeuille n'a pas pu être chargé
  // (réseau/session), on propose un « Réessayer » au lieu de rendre null.
  if (!state) {
    return (
      <section className="cgw" dir={dir}>
        <style>{RECHARGE_STYLE}</style>
        <div
          className="cgw-load"
          style={{ flexDirection: "column", gap: 14, padding: 24 }}
        >
          <p style={{ textAlign: "center", fontWeight: 600 }}>
            {lang === "ar"
              ? "تعذّر تحميل محفظتك. تحقّق من اتصالك."
              : "Impossible de charger votre portefeuille Coligo Pay. Vérifiez votre connexion."}
          </p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void refresh();
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 12,
              background: "var(--cg-brand, #6C2BD9)",
              color: "#fff",
              fontWeight: 700,
            }}
          >
            {lang === "ar" ? "إعادة المحاولة" : "Réessayer"}
          </button>
        </div>
      </section>
    );
  }

  // Retour ADAPTÉ à chaque utilisateur : on revient là d'où il vient (historique)
  // et, à défaut (accès direct par URL), sur l'accueil de SON espace selon le rôle.
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    const home =
      state.ownerType === "merchant"
        ? "/dashboard"
        : state.ownerType === "driver"
          ? "/driver"
          : state.ownerType === "chauffeur"
            ? "/chauffeur"
            : "/partenaire";
    router.push(home);
  };

  return (
    <section className="cgw" dir={dir}>
      <style>{RECHARGE_STYLE}</style>

      {!compact && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <button
            type="button"
            onClick={goBack}
            aria-label={lang === "ar" ? "رجوع" : "Retour"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 12,
              border: "1.5px solid var(--cgw-line, rgba(0,0,0,.12))",
              background: "transparent",
              color: "inherit",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: lang === "ar" ? "scaleX(-1)" : undefined }}
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span>{lang === "ar" ? "رجوع" : "Retour"}</span>
          </button>
          <div className="ph1" style={{ margin: 0 }}>
            {t.title}
          </div>
        </div>
      )}

      {/* HERO solde */}
      {!compact && (
        <div className="hero">
          <div className="top">
            <div className="wic">{Ico.wallet}</div>
            <div>
              <div className="lbl">{t.balanceLabel}</div>
            </div>
            <div className="ptag">
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 11l2-6h10l2 6M5 11h14v6H5z" />
              </svg>
              {OWNER_BADGE[lang][owner]}
            </div>
          </div>
          <div className="amt">
            {groupNum(state.effectiveBalanceDa)} <small>DA</small>
          </div>
          <div className="ctx">
            {Ico.info}
            <span>{OWNER_CTX[lang][owner]}</span>
          </div>
        </div>
      )}

      {/* Retour Chargily (inline) */}
      {topupReturn === "checking" && (
        <div className="cgw-ret">
          <span className="cgw-ret-ic">{Ico.spinner}</span>
          {t.checking}
        </div>
      )}
      {topupReturn === "confirmed" && (
        <div className="cgw-ret ok">
          {Ico.check} {t.confirmed}
        </div>
      )}
      {topupReturn === "failed" && <div className="cgw-ret ko">{t.failed}</div>}

      {/* Sélecteur de méthode */}
      <div className="secT">{title ?? t.rechargeTitle}</div>
      <div className="methods">
        <div
          className={method === "card" ? "m on" : "m"}
          onClick={() => setMethod("card")}
        >
          <div className="mi">{Ico.card}</div>
          <b>{t.mCard}</b>
          <span>{t.mCardDelay}</span>
          <span className="badge-i">{t.fast}</span>
        </div>
        <div
          className={method === "ccp" ? "m on" : "m"}
          onClick={() => setMethod("ccp")}
        >
          <div className="mi">{Ico.bank}</div>
          <b>{t.mCcp}</b>
          <span>{t.mCcpDelay}</span>
        </div>
        <div
          className={method === "cash" ? "m on" : "m"}
          onClick={() => setMethod("cash")}
        >
          <div className="mi">{Ico.cash}</div>
          <b>{t.mCash}</b>
          <span>{t.mCashDelay}</span>
        </div>
      </div>

      {/* PANNEAU CARTE */}
      {method === "card" && (
        <div className="panel">
          <div className="plab">{t.amountLabel}</div>
          <div className="chips">
            {presets.map((v) => (
              <div
                key={v}
                className={Number(amount) === v ? "chip on" : "chip"}
                onClick={() => setAmount(String(v))}
              >
                {groupNum(v)} DA
              </div>
            ))}
          </div>
          <input
            className="inp"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            placeholder={t.otherAmount}
          />
          <button
            className="btn"
            type="button"
            disabled={!amtValid || busy}
            onClick={() => void payCard()}
          >
            {busy ? Ico.spinner : Ico.card}
            {t.payCard}
          </button>
          <div className="note go">
            {Ico.check}
            {t.cardNote}
          </div>
          {err && <div className="cgw-err">{err}</div>}
        </div>
      )}

      {/* PANNEAU VIREMENT / CCP */}
      {method === "ccp" && (
        <div className="panel">
          <div className="steps">
            <div className="st">
              <div className="l">
                <div className="n">1</div>
                <div className="bar" />
              </div>
              <div className="tx">{t.step1}</div>
            </div>
            <div className="st">
              <div className="l">
                <div className="n">2</div>
                <div className="bar" />
              </div>
              <div className="tx">{t.step2}</div>
            </div>
            <div className="st">
              <div className="l">
                <div className="n">3</div>
                <div className="bar" />
              </div>
              <div className="tx">{t.step3}</div>
            </div>
            <div className="st">
              <div className="l">
                <div className="n">4</div>
              </div>
              <div className="tx">{t.step4}</div>
            </div>
          </div>

          <div className="ccpbox">
            <div className="cc">
              <div className="ck">{config?.ccpName || "Coligo"}</div>
              <div className="cv">
                {config?.ccpNumber
                  ? `${config.ccpNumber}${config.ccpKey ? ` · clé ${config.ccpKey}` : ""}`
                  : t.ccpUnset}
              </div>
              <div className="cs">{t.ccpRef}</div>
            </div>
            {config?.ccpNumber && (
              <div
                className="copy"
                onClick={() =>
                  void copyVal(
                    "ccp",
                    `${config.ccpNumber}${config.ccpKey ? ` clé ${config.ccpKey}` : ""}`
                  )
                }
              >
                {copied === "ccp" ? Ico.check : Ico.copy}
              </div>
            )}
          </div>

          {/* Compte bancaire (optionnel, selon le module) */}
          {config?.bankRib && (
            <div className="ccpbox">
              <div className="cc">
                <div className="ck">
                  {t.bankLabel}
                  {config.bankName ? ` · ${config.bankName}` : ""}
                </div>
                <div className="cv">{config.bankRib}</div>
                <div className="cs">{t.bankRibRef}</div>
              </div>
              <div
                className="copy"
                onClick={() => void copyVal("rib", config.bankRib ?? "")}
              >
                {copied === "rib" ? Ico.check : Ico.copy}
              </div>
            </div>
          )}

          <input
            className="inp"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            placeholder={t.amountSent}
            style={{ marginBottom: 11 }}
          />

          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            hidden
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <div
            className={file ? "drop done" : "drop"}
            onClick={() => fileRef.current?.click()}
          >
            <div className="di">{file ? Ico.check : Ico.image}</div>
            <b>{file ? t.proofAdded : t.addProof}</b>
            <span>{file ? `${file.name} ${t.proofReplace}` : t.proofHint}</span>
          </div>

          <button
            className="btn green"
            type="button"
            disabled={!amtValid || !file || busy}
            onClick={() => void submitManual()}
          >
            {busy ? Ico.spinner : Ico.send}
            {t.sendRequest}
          </button>
          <div className="note">
            {Ico.clock}
            {t.ccpNote}
          </div>
          {msg && <div className="cgw-ok">{msg}</div>}
          {err && <div className="cgw-err">{err}</div>}
        </div>
      )}

      {/* PANNEAU ESPÈCES */}
      {method === "cash" && (
        <div className="panel">
          <div className="plab">{t.cashTitle}</div>
          <CashFinder t={t} />
          <div className="note">
            {Ico.info}
            {t.cashNote}
          </div>
        </div>
      )}

      {/* DERNIÈRES OPÉRATIONS */}
      {!compact && entries.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="plab plab-sora">{t.opsTitle}</div>
          {entries.map((e, i) => {
            const credit = e.amountDa >= 0;
            // Opérations finance (commande/commission/versement…) : le libellé
            // vient du `note` ; les recharges/opérations wallet : du `type`.
            const label =
              e.type === "finance_mirror"
                ? (FINANCE_LABEL[lang][e.note ?? ""] ?? e.note ?? e.type)
                : (ENTRY_LABEL[lang][e.type] ?? e.type);
            return (
              <div className="op" key={i}>
                <div className={`oi ${credit ? "cr" : "db"}`}>
                  {credit ? Ico.up : Ico.down}
                </div>
                <div className="om">
                  <b>{label}</b>
                  <span>
                    {new Date(e.createdAt).toLocaleDateString(
                      lang === "ar" ? "ar-DZ" : "fr-DZ"
                    )}
                  </span>
                </div>
                <div className={`ov ${credit ? "cr" : "db"}`}>
                  {credit ? "+" : "−"}
                  {groupNum(e.amountDa)} DA
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Contacter le support — disponible sur la page Coligo Pay (chat Tawk
          si actif, sinon repli e-mail). Masqué si aucun canal n'est configuré. */}
      {isSupportConfigured() && (
        <button
          type="button"
          className="cgw-support"
          onClick={() =>
            openSupportChat({
              attributes: {
                sujet: "Coligo Pay",
                espace: OWNER_BADGE.fr[owner],
              },
            })
          }
        >
          {Ico.info}
          {t.support}
        </button>
      )}
    </section>
  );
}

/* ────────────────────── Panneau Espèces : annuaire agents ──────────────── */
type Point = {
  wallet_id: string;
  display_name: string | null;
  address: string | null;
  phone: string | null;
  hours: string | null;
  lat: number;
  lng: number;
  distance_km: number;
};
type Origin = { lat: number; lng: number; label: string };

function CashFinder({ t }: { t: (typeof STR)[Lang] }) {
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [phase, setPhase] = useState<"locating" | "manual" | "ready">(
    "locating"
  );
  const [points, setPoints] = useState<Point[] | null>(null);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  const [mapFailed, setMapFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cityQ, setCityQ] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [citySearching, setCitySearching] = useState(false);
  const [cityErr, setCityErr] = useState<string | null>(null);
  const [navFor, setNavFor] = useState<Point | null>(null);

  const locate = useCallback(async () => {
    setPhase("locating");
    setCityErr(null);
    const timeout = new Promise<null>((res) =>
      setTimeout(() => res(null), 9000)
    );
    try {
      const pos = await Promise.race([getPosition(), timeout]);
      if (pos) {
        setOrigin({ lat: pos.latitude, lng: pos.longitude, label: t.around });
        setPhase("ready");
      } else {
        setPhase("manual");
        setShowSearch(true);
      }
    } catch {
      setPhase("manual");
      setShowSearch(true);
    }
  }, [t.around]);

  useEffect(() => {
    void locate();
  }, [locate]);

  const load = useCallback(async (o: Origin) => {
    setLoadingPoints(true);
    setSelectedId(null);
    const supabase = createClient();
    const { data } = await supabase.rpc("recharge_points_nearby", {
      p_lat: o.lat,
      p_lng: o.lng,
      p_limit: 50,
      ...(o.label === t.around ? {} : { p_radius_override: 50 }),
    });
    setPoints((data ?? []) as Point[]);
    setLoadingPoints(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (origin) void load(origin);
  }, [origin, load]);

  const searchCity = useCallback(async () => {
    const q = cityQ.trim();
    if (q.length < 2) return;
    setCitySearching(true);
    setCityErr(null);
    const hit = await geocodeCommune(q, "");
    setCitySearching(false);
    if (!hit) {
      setCityErr(t.cityNotFound);
      return;
    }
    setShowSearch(false);
    setOrigin({ lat: hit.lat, lng: hit.lng, label: q });
    setPhase("ready");
  }, [cityQ, t.cityNotFound]);

  const goItinerary = (p: Point) => {
    const pref = getNavPref();
    if (pref) openNav(pref, p.lat, p.lng);
    else setNavFor(p);
  };

  const mapPoints: MapPoint[] = (points ?? []).map((p) => ({
    wallet_id: p.wallet_id,
    display_name: p.display_name,
    lat: p.lat,
    lng: p.lng,
    distance_km: p.distance_km,
  }));
  const selected = points?.find((p) => p.wallet_id === selectedId) ?? null;
  const showMap =
    view === "map" && !mapFailed && origin && (points?.length ?? 0) > 0;

  return (
    <div className="cash">
      {/* Barre recherche + bascule Liste/Carte */}
      <div className="findrow">
        <div className="loc" onClick={() => setShowSearch((v) => !v)}>
          {Ico.pin}
          <span className="loc-lbl">{origin?.label ?? t.cityPlaceholder}</span>
          <span className="mag">{Ico.search}</span>
        </div>
        <div className="vl">
          <button
            className={view === "list" ? "on" : ""}
            onClick={() => setView("list")}
          >
            {Ico.liste}
            {t.list}
          </button>
          <button
            className={view === "map" ? "on" : ""}
            onClick={() => setView("map")}
          >
            {Ico.mapIco}
            {t.map}
          </button>
        </div>
      </div>

      {showSearch && (
        <div className="citybox">
          <input
            className="inp"
            value={cityQ}
            onChange={(e) => setCityQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void searchCity();
            }}
            placeholder={t.cityPlaceholder}
          />
          <button
            className="citybtn"
            type="button"
            disabled={citySearching || cityQ.trim().length < 2}
            onClick={() => void searchCity()}
          >
            {citySearching ? Ico.spinner : t.search}
          </button>
        </div>
      )}
      {cityErr && <div className="cgw-err">{cityErr}</div>}

      <div className="useloc" onClick={() => void locate()}>
        {Ico.send}
        {t.useMyPos}
      </div>

      {(phase === "locating" || loadingPoints) && (
        <div className="cgw-mini-load">
          <span className="cgw-ret-ic">{Ico.spinner}</span>
          {phase === "locating" ? t.locating : t.searching}
        </div>
      )}

      {/* Carte */}
      {!loadingPoints && showMap && origin && (
        <div style={{ position: "relative" }}>
          <RechargePointsMap
            origin={origin}
            points={mapPoints}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMapError={() => {
              setMapFailed(true);
              setView("list");
            }}
            height={300}
          />
          {selected && (
            <div style={{ marginTop: 10 }}>
              <AgentCard
                p={selected}
                t={t}
                onItinerary={() => goItinerary(selected)}
              />
            </div>
          )}
          {!selected && <p className="cgw-hint">{t.tapPoint}</p>}
        </div>
      )}

      {/* Liste */}
      {!loadingPoints &&
        phase === "ready" &&
        (view === "list" || mapFailed || !showMap) &&
        points &&
        points.length > 0 &&
        points.map((p) => (
          <AgentCard
            key={p.wallet_id}
            p={p}
            t={t}
            onItinerary={() => goItinerary(p)}
          />
        ))}

      {/* Vide */}
      {!loadingPoints && phase === "ready" && points && points.length === 0 && (
        <div className="empty">
          <div className="ei">{Ico.store}</div>
          <b>{t.emptyTitle}</b>
          <span>{t.emptySub}</span>
        </div>
      )}

      {navFor && (
        <NavPicker
          t={t}
          onPick={(app) => {
            setNavPref(app);
            openNav(app, navFor.lat, navFor.lng);
            setNavFor(null);
          }}
          onClose={() => setNavFor(null)}
        />
      )}
    </div>
  );
}

function AgentCard({
  p,
  t,
  onItinerary,
}: {
  p: Point;
  t: (typeof STR)[Lang];
  onItinerary: () => void;
}) {
  const open = openStatus(p.hours);
  const sub = [p.address, p.hours].filter(Boolean).join(" · ");
  return (
    <div className="agent">
      <div className="ai">{Ico.store}</div>
      <div className="am">
        <b>{p.display_name ?? "Agent Coligo Pay"}</b>
        <span>
          {sub}
          {open !== null && ` · ${open ? t.openNow : t.closedNow}`}
        </span>
        <button className="miniroute" type="button" onClick={onItinerary}>
          {Ico.send}
          {t.itinerary}
        </button>
      </div>
      <div className="dist">{fmtDistance(p.distance_km)}</div>
    </div>
  );
}

function NavPicker({
  t,
  onPick,
  onClose,
}: {
  t: (typeof STR)[Lang];
  onPick: (app: NavApp) => void;
  onClose: () => void;
}) {
  return (
    <div className="cgw-sheet" onClick={onClose}>
      <div className="cgw-sheet-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="cgw-sheet-t">{t.openWith}</h2>
        <p className="cgw-sheet-s">{t.openWithSub}</p>
        {NAV_APPS.map((a) => (
          <button
            key={a.id}
            type="button"
            className="cgw-sheet-row"
            onClick={() => onPick(a.id)}
          >
            <span style={{ fontSize: 18 }}>{a.emoji}</span>
            {a.label}
          </button>
        ))}
        <button type="button" className="cgw-sheet-cancel" onClick={onClose}>
          {t.cancel}
        </button>
      </div>
    </div>
  );
}
