import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  Clock3,
  FileText,
  Rocket,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { BRAND_ASSETS } from "@/lib/config/brand-assets";
import { APP_CONFIG } from "@/lib/config/app-config";
import { cldUrl } from "@/lib/images/cloudinary";
import {
  getFeatureFlags,
  featureMessage,
  isVisible,
  type FeatureFlag,
  type FeatureKey,
} from "@/lib/data/feature-flags";
import { getRecruteContent } from "@/lib/data/recrute-content";
import {
  recruteDesignVars,
  type RecruteRole,
} from "@/lib/config/recrute-content";

export const metadata = {
  title: "Recrutement Coligo — devenez commerçant, livreur, chauffeur ou agent",
  description:
    "Rejoignez Coligo en Algérie : commerçants (0 DA à l'inscription), livreurs, chauffeurs (commission 0 % au lancement) et agents Coligo Pay. Dossier en ligne en 2 minutes, validation par l'équipe Coligo.",
};

// =============================================================================
// /recrute — page publique de recrutement des partenaires. Un choix de métier
// (commerçant, livreur, chauffeur, agent Coligo Pay), les avantages concrets de
// chacun, puis redirection DIRECTE vers le portail d'inscription existant.
// Chaque carte porte la PHOTO DE MARQUE de son domaine (les mêmes visuels que
// les héros des portails /signup → continuité quand le candidat est redirigé),
// servie via Cloudinary Fetch (recadrée au ratio d'affichage, jamais floue).
// Animations d'entrée 100 % CSS (fondu + montée en cascade, désactivées si
// prefers-reduced-motion) — design FLAT strict (aucune ombre décorative).
// Drapeaux : recruit_* par métier + kill-switch domaine coligo_pay_agents.
// =============================================================================

/**
 * Les cartes ne sont plus écrites ici : elles viennent de la base
 * (`recrute_page` / `recrute_roles`, mig 0450) et sont modifiables par
 * l'équipe depuis /admin/marketing/recrutement — photo, accroche, avantages
 * et habillage du héros. Les VALEURS PAR DÉFAUT restent dans le dépôt
 * (`lib/config/recrute-content.ts`) : la page reste complète et juste même si
 * la base est vide ou injoignable.
 */
type RoleCard = RecruteRole;

export default async function RecrutePage() {
  // Drapeaux et contenu sont INDÉPENDANTS → en parallèle, pas en cascade.
  const [flags, content] = await Promise.all([
    getFeatureFlags(),
    getRecruteContent(),
  ]);
  const ROLES = content.roles;
  // Kill-switch DOMAINE : réseau d'agents Coligo Pay masqué (coligo_pay_agents,
  // mig 0449) ⇒ la carte agent disparaît, quel que soit son drapeau recruit_*.
  const visible = ROLES.filter(
    (r) =>
      isVisible(flags[r.key]) &&
      (r.key !== "recruit_agent" || flags.coligo_pay_agents.status === "active")
  );

  return (
    <main className="bg-surface-2 min-h-screen">
      {/* Animations d'entrée LOCALES (CSS pur, RSC-safe) : fondu + montée en
          cascade, léger pop des gros chiffres, flottement lent du halo.
          Coupées pour prefers-reduced-motion. */}
      <style>{`
        @keyframes rcUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        @keyframes rcPop { 0% { opacity: 0; transform: scale(.94); } 65% { transform: scale(1.015); } 100% { opacity: 1; transform: none; } }
        @keyframes rcFloat { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-14px, 10px); } }
        .rc-up { animation: rcUp .55s cubic-bezier(.16, 1, .3, 1) both; }
        .rc-pop { animation: rcPop .65s cubic-bezier(.16, 1, .3, 1) both; }
        .rc-float { animation: rcFloat 9s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .rc-up, .rc-pop, .rc-float { animation: none; }
        }
      `}</style>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Link
          href="/"
          className="text-muted hover:text-foreground mb-6 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" /> Retour
        </Link>

        {/* ───── HERO — promesse + l'offre en très grand ───── */}
        {/* Habillage choisi par l'équipe : le dégradé passe par des variables
            CSS, jamais par des couleurs écrites dans le composant. */}
        <section
          className="relative overflow-hidden rounded-lg p-7 text-white lg:p-10"
          style={{
            ...recruteDesignVars(content.design),
            backgroundImage:
              "linear-gradient(135deg, var(--rc-g1), var(--rc-g2) 52%, var(--rc-g3))",
            backgroundColor: "var(--rc-g2)",
          }}
        >
          <div className="relative z-[1]">
            <Image
              src={BRAND_ASSETS.fullWhite}
              alt={APP_CONFIG.name}
              width={1000}
              height={401}
              className="rc-up h-8 w-auto"
              priority
            />
            <h1
              className="rc-up mt-5 max-w-xl text-3xl leading-tight font-black tracking-tight text-balance lg:text-4xl"
              style={{ animationDelay: "80ms" }}
            >
              {content.heroTitle ??
                `Travaillez avec ${APP_CONFIG.name}. Gagnez à votre rythme.`}
            </h1>
            <p
              className="rc-up mt-3 max-w-lg text-sm leading-relaxed text-white/85 lg:text-base"
              style={{ animationDelay: "160ms" }}
            >
              {content.heroSubtitle ??
                `Commerçant, livreur, chauffeur ou agent : choisissez votre métier, inscrivez-vous en ligne et démarrez après validation de votre dossier par l'équipe ${APP_CONFIG.name}.`}
            </p>
            {/* L'offre en TRÈS GRAND — l'argument n° 1 du recrutement. */}
            <div className="mt-7 flex flex-wrap items-end gap-x-10 gap-y-5">
              <div className="rc-pop" style={{ animationDelay: "240ms" }}>
                <p className="text-[64px] leading-none font-black tracking-tight lg:text-[96px]">
                  0&nbsp;%
                </p>
                <p className="text-body-sm mt-2 font-bold tracking-wide text-white/90 uppercase">
                  de commission au lancement
                </p>
              </div>
              <div className="rc-pop" style={{ animationDelay: "340ms" }}>
                <p className="text-[52px] leading-none font-black tracking-tight lg:text-[84px]">
                  Gratuit
                </p>
                <p className="text-body-sm mt-2 font-bold tracking-wide text-white/90 uppercase">
                  inscription en ligne, 0 DA
                </p>
              </div>
            </div>
            <p
              className="rc-up text-body-sm mt-5 font-semibold text-white/80"
              style={{ animationDelay: "440ms" }}
            >
              Dossier en 2 minutes · Support 24/7
            </p>
          </div>
          <div
            aria-hidden
            className="rc-float absolute -top-24 -right-24 size-72 rounded-full bg-white/10 blur-2xl"
          />
        </section>

        {/* ───── CHOIX DU MÉTIER ───── */}
        <section className="mt-8">
          <h2
            className="rc-up text-foreground text-xl font-bold tracking-tight"
            style={{ animationDelay: "120ms" }}
          >
            Choisissez votre métier
          </h2>
          <p
            className="rc-up text-muted mt-1 text-sm"
            style={{ animationDelay: "180ms" }}
          >
            Chaque inscription est gratuite et sans engagement.
          </p>

          {visible.length === 0 ? (
            <div className="border-border bg-surface mt-4 rounded-md border p-6 text-center">
              <p className="text-foreground text-title-sm font-bold">
                Les recrutements sont momentanément fermés.
              </p>
              <p className="text-muted mt-1 text-sm">
                Laissez-nous vos coordonnées, l&apos;équipe {APP_CONFIG.name}{" "}
                vous recontactera dès la réouverture.
              </p>
              <Link
                href="/contact"
                className="bg-primary-600 hover:bg-primary-700 rounded-control mt-4 inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-white transition-colors"
              >
                Nous contacter
              </Link>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {visible.map((r, i) => (
                <RoleCardView
                  key={r.key}
                  role={r}
                  flag={flags[r.key]}
                  delayMs={220 + i * 90}
                />
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
        <section className="border-border bg-surface mt-8 rounded-md border p-5">
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
        <section className="border-border bg-surface mt-8 rounded-md border p-6 text-center">
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
              className="bg-primary-600 hover:bg-primary-700 rounded-control inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-white transition-colors"
            >
              Nous contacter
            </Link>
            <Link
              href="/centre-aide"
              className="border-border text-foreground hover:bg-surface-2 rounded-control inline-flex items-center gap-1.5 border px-4 py-2.5 text-sm font-semibold transition-colors"
            >
              Centre d&apos;aide
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

/** Carte métier — photo de marque du domaine + état piloté par recruit_*. */
function RoleCardView({
  role,
  flag,
  delayMs,
}: {
  role: RoleCard;
  flag: FeatureFlag;
  delayMs: number;
}) {
  const active = flag.status === "active";
  const soon = flag.status === "coming_soon";
  const message = active ? null : featureMessage(flag, "fr");
  const img =
    cldUrl(role.img, {
      width: 720,
      height: 400,
      crop: "fill",
      gravity: "auto",
    }) ?? role.img;

  return (
    <div
      className={`rc-up border-border bg-surface group rounded-card-lg flex flex-col overflow-hidden border ${
        active ? "" : "opacity-75"
      }`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {/* Bannière photo du domaine : titre + accroche posés sur un voile
          sombre (lisibilité garantie), badge avantage par-dessus. */}
      <div className="relative h-36 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img}
          alt={role.imgAlt}
          loading="lazy"
          decoding="async"
          className={`h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04] ${
            active ? "" : "grayscale"
          }`}
        />
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/65 to-transparent"
        />
        <span className="text-primary-700 text-caption-lg absolute start-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 font-extrabold">
          <BadgeCheck className="size-3.5" />
          {role.highlight}
        </span>
        <div className="absolute inset-x-0 bottom-0 p-3.5">
          <h3 className="text-title-lg font-black text-white">{role.title}</h3>
          <p className="text-label-lg mt-0.5 leading-snug text-white/85">
            {role.tagline}
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <ul className="flex-1 space-y-1.5">
          {role.perks.map((p) => (
            <li key={p} className="flex items-start gap-2">
              <Check className="text-primary-600 mt-0.5 size-4 shrink-0" />
              <span className="text-muted text-body-sm leading-snug">{p}</span>
            </li>
          ))}
        </ul>

        {active ? (
          <Link
            href={role.href}
            className="bg-primary-600 hover:bg-primary-700 rounded-control mt-4 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-bold text-white transition-colors"
          >
            {role.cta}
            <ArrowRight className="size-4 rtl:-scale-x-100" />
          </Link>
        ) : (
          <div className="bg-surface-2 text-muted rounded-control mt-4 px-4 py-2.5 text-center text-sm font-semibold">
            {soon ? "Bientôt disponible" : "Recrutement suspendu"}
            {message ? (
              <span className="text-subtle mt-0.5 block text-xs font-normal">
                {message}
              </span>
            ) : null}
          </div>
        )}
      </div>
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
    <div className="border-border bg-surface rounded-md border p-4">
      <div className="flex items-center gap-2">
        <span className="bg-primary-600 text-body-sm grid size-7 shrink-0 place-items-center rounded-full font-black text-white">
          {n}
        </span>
        <span className="text-primary-600">{icon}</span>
      </div>
      <h3 className="text-foreground text-title-sm mt-2.5 font-bold">
        {title}
      </h3>
      <p className="text-muted text-body-sm mt-1 leading-relaxed">{text}</p>
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
      <span className="bg-primary-50 text-primary-600 rounded-control grid size-9 shrink-0 place-items-center">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-foreground text-body-lg font-bold">{title}</p>
        <p className="text-muted text-body-sm mt-0.5 leading-snug">{text}</p>
      </div>
    </div>
  );
}
