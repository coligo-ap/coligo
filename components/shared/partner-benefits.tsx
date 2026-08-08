"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import {
  ArrowRight,
  ArrowUp,
  Banknote,
  Clock,
  MapPin,
  Percent,
  Rocket,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { ThemeDecor } from "@/components/shared/theme-decor";
import type { AuthVariant } from "@/components/shared/auth-nav";
import { cn } from "@/lib/utils";

// =============================================================================
// Section MARKETING des portails d'auth PARTENAIRES (commerçant, livreur,
// chauffeur, Agent Coligo Pay) — découverte AU SCROLL sous la carte de
// connexion/inscription. Ce que chaque rôle veut entendre, dans l'ordre qui
// compte pour lui : BUSINESS d'abord (clients, ventes, revenus), la facilité
// ensuite, la fiabilité/sécurité en DERNIER. Texte minimal (une carte = un
// titre percutant + UNE ligne), apparition en cascade au scroll
// (IntersectionObserver, coupée par prefers-reduced-motion), bannière CTA au
// dégradé du thème « occasion » (vars posées sur <html>). Bilingue FR/AR.
// Rendue automatiquement par AuthScreen — aucune page à modifier.
// =============================================================================

type Benefit = {
  icon: LucideIcon;
  /** Pastille icône : classes fond + texte. */
  tint: string;
  t: [string, string]; // [fr, ar]
  d: [string, string];
};

type RoleContent = {
  eyebrow: [string, string];
  title: [string, string];
  signupHref: string;
  stats: { v: [string, string]; l: [string, string] }[];
  items: Benefit[];
  cta: [string, string];
};

const CONTENT: Record<Exclude<AuthVariant, "customer">, RoleContent> = {
  merchant: {
    eyebrow: ["Pourquoi Coligo ?", "لماذا كوليغو؟"],
    title: ["Développez votre commerce.", "طوّر تجارتك."],
    signupHref: "/signup",
    stats: [
      { v: ["0 DA", "0 دج"], l: ["Inscription", "التسجيل"] },
      { v: ["5%", "5%"], l: ["Commission", "العمولة"] },
      { v: ["2 min", "دقيقتان"], l: ["Pour s'inscrire", "للتسجيل"] },
      { v: ["24/7", "24/7"], l: ["Support", "الدعم"] },
    ],
    items: [
      {
        icon: Users,
        tint: "bg-primary-50 text-primary-700",
        t: ["De nouveaux clients", "زبائن جدد"],
        d: [
          "Votre boutique visible par toute votre ville.",
          "متجرك يظهر لكل مدينتك.",
        ],
      },
      {
        icon: TrendingUp,
        tint: "bg-emerald-50 text-emerald-700",
        t: ["Plus de ventes", "مبيعات أكثر"],
        d: [
          "Commandes en continu, sur place ou en livraison.",
          "طلبات متواصلة، استلام في المحل أو توصيل.",
        ],
      },
      {
        icon: Banknote,
        tint: "bg-amber-50 text-amber-700",
        t: ["Revenus maîtrisés", "مداخيل واضحة"],
        d: [
          "Versements clairs, finances suivies en temps réel.",
          "دفعات واضحة ومالية تُتابع لحظيًا.",
        ],
      },
      {
        icon: Rocket,
        tint: "bg-rose-50 text-rose-700",
        t: ["Simple à gérer", "سهل التسيير"],
        d: [
          "Catalogue, commandes et promos en quelques taps.",
          "الكتالوج والطلبات والعروض بلمسات قليلة.",
        ],
      },
      {
        icon: ShieldCheck,
        tint: "bg-sky-50 text-sky-700",
        t: ["Fiable et sécurisé", "موثوق وآمن"],
        d: [
          "Paiements protégés, l'équipe Coligo à vos côtés.",
          "مدفوعات محمية وفريق كوليغو إلى جانبك.",
        ],
      },
    ],
    cta: ["Ouvrez votre boutique sur Coligo.", "افتح متجرك على كوليغو."],
  },
  driver: {
    eyebrow: ["Pourquoi Coligo ?", "لماذا كوليغو؟"],
    title: ["Gagnez avec vos livraisons.", "اربح من توصيلاتك."],
    signupHref: "/driver/signup",
    stats: [
      { v: ["2 min", "دقيقتان"], l: ["Pour s'inscrire", "للتسجيل"] },
      { v: ["24-48 h", "24-48 سا"], l: ["Validation", "المصادقة"] },
      { v: ["24/7", "24/7"], l: ["Support", "الدعم"] },
    ],
    items: [
      {
        icon: Banknote,
        tint: "bg-emerald-50 text-emerald-700",
        t: ["Des gains à chaque course", "أرباح في كل توصيلة"],
        d: [
          "Payé pour chaque livraison, pourboires inclus.",
          "تُدفع لك كل توصيلة، والإكراميات لك.",
        ],
      },
      {
        icon: Clock,
        tint: "bg-primary-50 text-primary-700",
        t: ["Vous êtes libre", "أنت حرّ"],
        d: [
          "Travaillez quand vous voulez, sans horaires imposés.",
          "اعمل متى شئت، بلا أوقات مفروضة.",
        ],
      },
      {
        icon: MapPin,
        tint: "bg-amber-50 text-amber-700",
        t: ["Courses près de vous", "توصيلات قريبة منك"],
        d: [
          "Les offres arrivent autour de votre position.",
          "العروض تصلك حول موقعك.",
        ],
      },
      {
        icon: Smartphone,
        tint: "bg-rose-50 text-rose-700",
        t: ["Tout dans l'app", "كل شيء في التطبيق"],
        d: [
          "Gains, historique et navigation intégrés.",
          "الأرباح والسجل والملاحة في مكان واحد.",
        ],
      },
      {
        icon: ShieldCheck,
        tint: "bg-sky-50 text-sky-700",
        t: ["Gains suivis et versés", "أرباح مضمونة"],
        d: [
          "Chaque dinar est tracé et versé, sans surprise.",
          "كل دينار مُتتبع ويُدفع، بلا مفاجآت.",
        ],
      },
    ],
    cta: ["Commencez à livrer avec Coligo.", "ابدأ التوصيل مع كوليغو."],
  },
  chauffeur: {
    eyebrow: ["Pourquoi Coligo Drive ?", "لماذا كوليغو درايف؟"],
    title: ["Conduisez, encaissez.", "سُق واربح."],
    signupHref: "/chauffeur/signup",
    stats: [
      { v: ["0%", "0%"], l: ["Commission au lancement", "عمولة عند الانطلاق"] },
      { v: ["2 min", "دقيقتان"], l: ["Pour s'inscrire", "للتسجيل"] },
      { v: ["24/7", "24/7"], l: ["Support", "الدعم"] },
    ],
    items: [
      {
        icon: Percent,
        tint: "bg-emerald-50 text-emerald-700",
        t: ["0% de commission au lancement", "عمولة 0% عند الانطلاق"],
        d: [
          "Vos courses, vos revenus — intégralement.",
          "مشاويرك ومداخيلك — كاملة لك.",
        ],
      },
      {
        icon: Clock,
        tint: "bg-primary-50 text-primary-700",
        t: ["Liberté totale", "حرية تامة"],
        d: [
          "Aucun horaire imposé, vous choisissez vos courses.",
          "لا أوقات مفروضة، أنت تختار مشاويرك.",
        ],
      },
      {
        icon: MapPin,
        tint: "bg-amber-50 text-amber-700",
        t: ["Demandes autour de vous", "طلبات حولك"],
        d: [
          "Les clients proches arrivent en temps réel.",
          "الزبائن القريبون يصلونك لحظيًا.",
        ],
      },
      {
        icon: Smartphone,
        tint: "bg-rose-50 text-rose-700",
        t: ["Application complète", "تطبيق متكامل"],
        d: [
          "Navigation, gains et revenus — tout-en-un.",
          "الملاحة والأرباح والمداخيل في تطبيق واحد.",
        ],
      },
      {
        icon: ShieldCheck,
        tint: "bg-sky-50 text-sky-700",
        t: ["Cadre sécurisé", "إطار آمن"],
        d: [
          "Trajets tracés, numéros masqués, appels in-app.",
          "مسارات مُتتبعة وأرقام مخفية ومكالمات داخل التطبيق.",
        ],
      },
    ],
    cta: ["Prenez la route avec Coligo Drive.", "انطلق مع كوليغو درايف."],
  },
  partner: {
    eyebrow: ["Pourquoi Coligo Pay ?", "لماذا كوليغو باي؟"],
    title: ["Devenez point de recharge.", "كن نقطة تعبئة."],
    signupHref: "/partenaire/signup",
    stats: [
      { v: ["0 DA", "0 دج"], l: ["Matériel requis", "معدات مطلوبة"] },
      { v: ["2 min", "دقيقتان"], l: ["Par vente", "لكل عملية بيع"] },
      { v: ["24/7", "24/7"], l: ["Support", "الدعم"] },
    ],
    items: [
      {
        icon: Percent,
        tint: "bg-emerald-50 text-emerald-700",
        t: ["Un revenu en plus", "دخل إضافي"],
        d: [
          "Une marge sur chaque recharge vendue, sans stock.",
          "هامش على كل تعبئة تبيعها، بلا مخزون.",
        ],
      },
      {
        icon: Users,
        tint: "bg-primary-50 text-primary-700",
        t: ["Plus de passage en boutique", "حركة أكثر في محلك"],
        d: [
          "Les clients Coligo viennent recharger chez vous.",
          "زبائن كوليغو يأتون للتعبئة عندك.",
        ],
      },
      {
        icon: Smartphone,
        tint: "bg-amber-50 text-amber-700",
        t: ["Un téléphone suffit", "هاتف واحد يكفي"],
        d: [
          "Scannez, encaissez, c'est vendu — rien d'autre.",
          "امسح، استلم المبلغ، وتمّ البيع — لا شيء آخر.",
        ],
      },
      {
        icon: ShieldCheck,
        tint: "bg-sky-50 text-sky-700",
        t: ["Sécurisé de bout en bout", "آمن من البداية للنهاية"],
        d: [
          "PIN, plafonds et suivi de chaque opération.",
          "رمز سري وسقوف وتتبع لكل عملية.",
        ],
      },
    ],
    cta: ["Rejoignez le réseau Coligo Pay.", "انضم إلى شبكة كوليغو باي."],
  },
};

export function PartnerBenefits({ variant }: { variant: AuthVariant }) {
  const isAr = useLocale() === "ar";
  const pathname = usePathname();
  const pick = (pair: [string, string]) => (isAr ? pair[1] : pair[0]);

  // Apparition en cascade quand la section entre à l'écran. Filet : révélée
  // d'office après 1,5 s (IO indisponible / JS lent) — jamais de section
  // invisible. `motion-reduce:*` neutralise le mouvement.
  const rootRef = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const t = setTimeout(() => setShown(true), 1500);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setShown(true);
      },
      { rootMargin: "0px 0px -60px 0px" }
    );
    io.observe(el);
    return () => {
      clearTimeout(t);
      io.disconnect();
    };
  }, []);

  if (variant === "customer") return null;
  const c = CONTENT[variant];
  const onSignupPage = pathname === c.signupHref;

  // Classe d'apparition (le décalage en cascade vient du transitionDelay inline).
  const reveal = cn(
    "transition-all duration-500 ease-out motion-reduce:transition-none",
    shown
      ? "translate-y-0 opacity-100"
      : "translate-y-4 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100"
  );

  return (
    <section
      ref={rootRef}
      aria-label={pick(c.eyebrow)}
      className="bg-surface-2 px-4 pt-2 pb-10 lg:bg-white"
    >
      <div className="mx-auto w-full max-w-md lg:max-w-4xl">
        {/* En-tête : eyebrow pilule + titre court. */}
        <div className={reveal} style={{ transitionDelay: "0ms" }}>
          <div className="flex flex-col items-center gap-2 pt-6 text-center">
            <span className="bg-primary-50 text-primary-700 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold">
              {pick(c.eyebrow)}
            </span>
            <h2 className="text-foreground text-2xl font-extrabold tracking-tight">
              {pick(c.title)}
            </h2>
          </div>
        </div>

        {/* Chiffres-clés — la promesse en un coup d'œil. */}
        <div
          className={cn("mt-5 grid gap-2", reveal)}
          style={{
            gridTemplateColumns: `repeat(${c.stats.length}, minmax(0,1fr))`,
            transitionDelay: "80ms",
          }}
        >
          {c.stats.map((s) => (
            <div
              key={s.l[0]}
              className="border-border rounded-card-lg border bg-white p-2.5 text-center"
            >
              <div className="text-primary-700 text-lg leading-tight font-extrabold tabular-nums">
                {pick(s.v)}
              </div>
              <div className="text-muted text-micro-lg mt-0.5 leading-tight font-medium">
                {pick(s.l)}
              </div>
            </div>
          ))}
        </div>

        {/* Bénéfices — business d'abord, sécurité en dernier. */}
        <div className="mt-3 grid gap-2.5 lg:grid-cols-2">
          {c.items.map((b, i) => {
            const Icon = b.icon;
            return (
              <div
                key={b.t[0]}
                className={cn(
                  "border-border rounded-sheet-lg flex items-center gap-3 border bg-white p-3.5",
                  reveal
                )}
                style={{ transitionDelay: `${160 + i * 80}ms` }}
              >
                <span
                  className={cn(
                    "rounded-card-lg grid size-11 shrink-0 place-items-center",
                    b.tint
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-foreground text-title-sm leading-tight font-bold">
                    {pick(b.t)}
                  </p>
                  <p className="text-muted mt-0.5 text-xs leading-snug">
                    {pick(b.d)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* CTA — bannière au dégradé du thème (mêmes vars que les héros). */}
        <div className={reveal} style={{ transitionDelay: "600ms" }}>
          <div
            className="relative mt-4 overflow-hidden rounded-xl p-5 text-white"
            style={{
              backgroundImage:
                "linear-gradient(140deg, var(--auth-g1,#6C2BD9) 0%, var(--auth-g2,#5B21B6) 55%, var(--auth-g3,#4C1B9B) 100%)",
            }}
          >
            <ThemeDecor />
            <div className="relative z-10 flex flex-col items-center gap-3 text-center">
              <p className="text-lg leading-snug font-extrabold drop-shadow-sm">
                {pick(c.cta)}
              </p>
              {onSignupPage ? (
                <button
                  type="button"
                  onClick={() =>
                    window.scrollTo({ top: 0, behavior: "smooth" })
                  }
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-neutral-900 transition-transform active:scale-[.97]"
                >
                  {isAr ? "أكمل تسجيلي في الأعلى" : "Je finis mon inscription"}
                  <ArrowUp className="size-4" />
                </button>
              ) : (
                <Link
                  href={c.signupHref}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-neutral-900 transition-transform active:scale-[.97]"
                >
                  {isAr ? "أنشئ حسابي مجانًا" : "Je crée mon compte gratuit"}
                  <ArrowRight className="size-4 rtl:rotate-180" />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
