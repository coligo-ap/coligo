import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bike,
  Car,
  Check,
  Clock3,
  FileText,
  Rocket,
  ShieldCheck,
  Store,
  Wallet,
} from "lucide-react";
import { BRAND_ASSETS } from "@/lib/config/brand-assets";
import { APP_CONFIG } from "@/lib/config/app-config";
import {
  getFeatureFlags,
  featureMessage,
  isVisible,
  type FeatureFlag,
  type FeatureKey,
} from "@/lib/data/feature-flags";

export const metadata = {
  title: "Recrutement Coligo — devenez commerçant, livreur, chauffeur ou agent",
  description:
    "Rejoignez Coligo en Algérie : commerçants (0 DA à l'inscription), livreurs, chauffeurs (commission 0 % au lancement) et agents Coligo Pay. Dossier en ligne en 2 minutes, validation par l'équipe Coligo.",
};

// =============================================================================
// /recrute — page publique de recrutement des partenaires. Un choix de métier
// (commerçant, livreur, chauffeur, agent Coligo Pay), les avantages concrets de
// chacun, puis redirection DIRECTE vers le portail d'inscription existant.
// Chaque métier est pilotable depuis /admin/controle (drapeaux recruit_*) :
// masqué = carte retirée, bientôt/maintenance = carte grisée sans lien.
// La vraie barrière métier reste la validation des dossiers par l'équipe.
// =============================================================================

type RoleCard = {
  key: FeatureKey;
  icon: React.ReactNode;
  title: string;
  tagline: string;
  highlight: string;
  perks: string[];
  href: string;
  cta: string;
};

const ROLES: RoleCard[] = [
  {
    key: "recruit_chauffeur",
    icon: <Car className="size-5" />,
    title: "Chauffeur",
    tagline: "Transportez des passagers avec Coligo Drive.",
    highlight: "Commission 0 % au lancement",
    perks: [
      "Vous proposez votre prix sur chaque course",
      "Ville, inter-wilayas et covoiturage par places",
      "Gains en espèces ou Coligo Pay, détaillés dans l'app",
    ],
    href: "/chauffeur/signup",
    cta: "Devenir chauffeur",
  },
  {
    key: "recruit_merchant",
    icon: <Store className="size-5" />,
    title: "Commerçant",
    tagline: "Vendez en ligne à tout votre quartier.",
    highlight: "0 DA à l'inscription",
    perks: [
      "Commission uniquement sur les ventes, aucun abonnement",
      "Boutique en ligne + livraison express intégrée",
      "Caisse, tickets imprimés et statistiques inclus",
    ],
    href: "/signup",
    cta: "Devenir commerçant",
  },
  {
    key: "recruit_driver",
    icon: <Bike className="size-5" />,
    title: "Livreur",
    tagline: "Livrez les commandes près de chez vous.",
    highlight: "Gains à chaque course",
    perks: [
      "Vous choisissez votre zone et vos horaires",
      "Courses express et tournées programmées",
      "Revenus suivis en direct, versements transparents",
    ],
    href: "/driver/signup",
    cta: "Devenir livreur",
  },
  {
    key: "recruit_agent",
    icon: <Wallet className="size-5" />,
    title: "Agent Coligo Pay",
    tagline: "Encaissez les recharges de votre quartier.",
    highlight: "Commission sur chaque recharge",
    perks: [
      "Un téléphone suffit : QR simple, zéro matériel",
      "Vous devenez le point de recharge du quartier",
      "Portefeuille et commissions suivis dans l'app",
    ],
    href: "/partenaire/signup",
    cta: "Devenir agent",
  },
];

export default async function RecrutePage() {
  const flags = await getFeatureFlags();
  const visible = ROLES.filter((r) => isVisible(flags[r.key]));

  return (
    <main className="bg-surface-2 min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Link
          href="/"
          className="text-muted hover:text-foreground mb-6 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" /> Retour
        </Link>

        {/* ───── HERO — promesse + chiffres clés ───── */}
        <section className="cg-brand-gradient relative overflow-hidden rounded-[16px] p-7 text-white lg:p-10">
          <div className="relative z-[1]">
            <Image
              src={BRAND_ASSETS.fullWhite}
              alt={APP_CONFIG.name}
              width={1000}
              height={401}
              className="h-8 w-auto"
              priority
            />
            <h1 className="mt-5 max-w-xl text-3xl leading-tight font-black tracking-tight text-balance lg:text-4xl">
              Travaillez avec {APP_CONFIG.name}. Gagnez à votre rythme.
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/85 lg:text-base">
              Commerçant, livreur, chauffeur ou agent : choisissez votre métier,
              inscrivez-vous en ligne et démarrez après validation de votre
              dossier par l&apos;équipe {APP_CONFIG.name}.
            </p>
            <div className="mt-6 grid max-w-md grid-cols-4 gap-2">
              <HeroStat value="0 DA" label="Inscription" />
              <HeroStat value="2 min" label="Dossier" />
              <HeroStat value="100 %" label="En ligne" />
              <HeroStat value="24/7" label="Support" />
            </div>
          </div>
          <div
            aria-hidden
            className="absolute -top-24 -right-24 size-72 rounded-full bg-white/10 blur-2xl"
          />
        </section>

        {/* ───── CHOIX DU MÉTIER ───── */}
        <section className="mt-8">
          <h2 className="text-foreground text-xl font-bold tracking-tight">
            Choisissez votre métier
          </h2>
          <p className="text-muted mt-1 text-sm">
            Chaque inscription est gratuite et sans engagement.
          </p>

          {visible.length === 0 ? (
            <div className="border-border bg-surface mt-4 rounded-[12px] border p-6 text-center">
              <p className="text-foreground text-[15px] font-bold">
                Les recrutements sont momentanément fermés.
              </p>
              <p className="text-muted mt-1 text-sm">
                Laissez-nous vos coordonnées, l&apos;équipe {APP_CONFIG.name}{" "}
                vous recontactera dès la réouverture.
              </p>
              <Link
                href="/contact"
                className="bg-primary-600 hover:bg-primary-700 mt-4 inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2.5 text-sm font-bold text-white transition-colors"
              >
                Nous contacter
              </Link>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {visible.map((r) => (
                <RoleCardView key={r.key} role={r} flag={flags[r.key]} />
              ))}
            </div>
          )}
        </section>

        {/* ───── COMMENT ÇA MARCHE ───── */}
        <section className="mt-8">
          <h2 className="text-foreground text-xl font-bold tracking-tight">
            Comment ça marche
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Step
              n={1}
              icon={<FileText className="size-5" />}
              title="Dossier en ligne"
              text="2 minutes depuis votre téléphone, une question à la fois."
            />
            <Step
              n={2}
              icon={<ShieldCheck className="size-5" />}
              title="Validation"
              text={`L'équipe ${APP_CONFIG.name} vérifie votre dossier — c'est ce qui garantit la confiance des clients.`}
            />
            <Step
              n={3}
              icon={<Rocket className="size-5" />}
              title="Démarrage"
              text="Votre compte est activé : vous commencez à gagner."
            />
          </div>
        </section>

        {/* ───── RÉASSURANCE ───── */}
        <section className="border-border bg-surface mt-8 rounded-[12px] border p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Reassure
              icon={<BadgeCheck className="size-5" />}
              title="Partenaires vérifiés"
              text="Chaque dossier est contrôlé avant activation."
            />
            <Reassure
              icon={<Clock3 className="size-5" />}
              title="Vous restez libre"
              text="Pas d'horaires imposés, pas d'exclusivité."
            />
            <Reassure
              icon={<Wallet className="size-5" />}
              title="Revenus clairs"
              text="Montants détaillés et relevés dans l'application."
            />
          </div>
        </section>

        {/* ───── CTA CONTACT ───── */}
        <section className="border-border bg-surface mt-8 rounded-[12px] border p-6 text-center">
          <h2 className="text-foreground text-lg font-extrabold">
            Une question avant de vous lancer ?
          </h2>
          <p className="text-muted mx-auto mt-1.5 max-w-md text-sm">
            L&apos;équipe {APP_CONFIG.name} vous répond et vous accompagne à
            chaque étape de votre inscription.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link
              href="/contact"
              className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2.5 text-sm font-bold text-white transition-colors"
            >
              Nous contacter
            </Link>
            <Link
              href="/centre-aide"
              className="border-border text-foreground hover:bg-surface-2 inline-flex items-center gap-1.5 rounded-[10px] border px-4 py-2.5 text-sm font-semibold transition-colors"
            >
              Centre d&apos;aide
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

/** Mini-chiffre du héro (fond translucide sur le dégradé de marque). */
function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[10px] bg-white/10 px-2 py-2 text-center">
      <p className="text-sm font-black">{value}</p>
      <p className="mt-0.5 text-[10px] font-medium text-white/75">{label}</p>
    </div>
  );
}

/** Carte métier — état piloté par le drapeau recruit_* du super-admin. */
function RoleCardView({ role, flag }: { role: RoleCard; flag: FeatureFlag }) {
  const active = flag.status === "active";
  const soon = flag.status === "coming_soon";
  const message = active ? null : featureMessage(flag, "fr");

  return (
    <div
      className={`border-border bg-surface flex flex-col rounded-[12px] border p-5 ${
        active ? "" : "opacity-70"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="bg-primary-50 text-primary-600 grid size-11 shrink-0 place-items-center rounded-[10px]">
          {role.icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-foreground text-[16px] font-bold">
            {role.title}
          </h3>
          <p className="text-muted mt-0.5 text-[13px] leading-snug">
            {role.tagline}
          </p>
        </div>
      </div>

      <span className="bg-primary-50 text-primary-700 mt-3 inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold">
        <BadgeCheck className="size-3.5" />
        {role.highlight}
      </span>

      <ul className="mt-3 flex-1 space-y-1.5">
        {role.perks.map((p) => (
          <li key={p} className="flex items-start gap-2">
            <Check className="text-primary-600 mt-0.5 size-4 shrink-0" />
            <span className="text-muted text-[13px] leading-snug">{p}</span>
          </li>
        ))}
      </ul>

      {active ? (
        <Link
          href={role.href}
          className="bg-primary-600 hover:bg-primary-700 mt-4 inline-flex items-center justify-center gap-1.5 rounded-[10px] px-4 py-2.5 text-sm font-bold text-white transition-colors"
        >
          {role.cta}
          <ArrowRight className="size-4 rtl:-scale-x-100" />
        </Link>
      ) : (
        <div className="bg-surface-2 text-muted mt-4 rounded-[10px] px-4 py-2.5 text-center text-sm font-semibold">
          {soon ? "Bientôt disponible" : "Recrutement suspendu"}
          {message ? (
            <span className="text-subtle mt-0.5 block text-xs font-normal">
              {message}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Étape numérotée du « comment ça marche ». */
function Step({
  n,
  icon,
  title,
  text,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="border-border bg-surface rounded-[12px] border p-4">
      <div className="flex items-center gap-2">
        <span className="bg-primary-600 grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-black text-white">
          {n}
        </span>
        <span className="text-primary-600">{icon}</span>
      </div>
      <h3 className="text-foreground mt-2.5 text-[15px] font-bold">{title}</h3>
      <p className="text-muted mt-1 text-[13px] leading-relaxed">{text}</p>
    </div>
  );
}

/** Ligne de réassurance (icône + titre + texte court). */
function Reassure({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="bg-primary-50 text-primary-600 grid size-9 shrink-0 place-items-center rounded-[10px]">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-foreground text-[14px] font-bold">{title}</p>
        <p className="text-muted mt-0.5 text-[13px] leading-snug">{text}</p>
      </div>
    </div>
  );
}
