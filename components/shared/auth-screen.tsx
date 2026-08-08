import type { ReactNode } from "react";
import { useLocale } from "next-intl";
import {
  AuthFooter,
  AuthNavBar,
  type AuthVariant,
} from "@/components/shared/auth-nav";
import { InstallBanner } from "@/components/pwa/install-banner";
import { Logo } from "@/components/shared/logo";
import { AuthCard } from "@/components/shared/auth-card";
import { PartnerBenefits } from "@/components/shared/partner-benefits";
import { PartnerAppCard } from "@/components/shared/partner-app-card";
import { AppOpenOrInstall } from "@/components/shared/app-open-or-install";
import { ScrollToTopOnMount } from "@/components/shared/scroll-to-top-on-mount";
import { APP_CONFIG } from "@/lib/config/app-config";
import { cn } from "@/lib/utils";

/**
 * Chrome d'authentification UNIFIÉ, repris À L'IDENTIQUE du portail commerçant
 * (cf. app/(auth)/login). Tous les portails (commerçant, livreur, chauffeur,
 * Agent Coligo Pay) partagent ainsi le MÊME bandeau, le MÊME panneau marketing
 * gauche (desktop) et la MÊME carte de formulaire à droite — seuls le contenu
 * du hero, le titre de la carte et le formulaire (passé en `children`) changent.
 *
 * → garantit l'authenticité visuelle « Coligo » sur l'ensemble des espaces.
 */
export function AuthScreen({
  navVariant,
  hero,
  cardTitle,
  cardSubtitle,
  installLabel,
  installClassName,
  showPortal = false,
  modeTabs,
  children,
  footer,
  bottomNav,
}: {
  navVariant: AuthVariant;
  /**
   * Panneau marketing gauche (desktop only) : logo + titre + sous-titre, puis
   * SOIT une liste d'arguments (`features`), SOIT une grille de chiffres-clés
   * (`stats`). `imageUrl` optionnel : sans photo, le dégradé primaire tient lieu
   * de fond (parcours d'inscription client).
   */
  hero: {
    title: ReactNode;
    subtitle: string;
    features?: string[];
    stats?: { value: string; label: string }[];
    imageUrl?: string;
  };
  cardTitle: string;
  cardSubtitle: string;
  installLabel?: string;
  /** Position custom du bandeau d'installation (client : au-dessus de sa nav). */
  installClassName?: string;
  /** Lien discret vers le portail super-admin (réservé au commerçant). */
  showPortal?: boolean;
  /**
   * Sélecteur « J'ai déjà un compte » / « Je crée mon compte », en TÊTE de la
   * carte. C'est la première chose à lire : elle dit dans quel parcours on est.
   */
  modeTabs?: ReactNode;
  /** Le formulaire de connexion / création de compte. */
  children: ReactNode;
  /** Bloc bas de carte (mot de passe oublié, conditions générales, OAuth…). */
  footer?: ReactNode;
  /** Barre de navigation basse persistante (client) — rendue sous le châssis. */
  bottomNav?: ReactNode;
}) {
  // `useLocale` (PAS getLocale) : ce châssis est rendu côté serveur par les
  // portails livreur/chauffeur/commerçant MAIS AUSSI importé par des pages
  // CLIENT (« use client » : /se-connecter, /inscription). getLocale est
  // server-only et CASSAIT le SSR de ces pages (React #419, incident du
  // 15/07) ; useLocale est isomorphe.
  const isAr = useLocale() === "ar";
  return (
    <>
      <div
        className={cn(
          "flex min-h-screen flex-col",
          // La nav basse client est FIXED et ajoute env(safe-area-inset-bottom)
          // à sa hauteur : la marge réservée doit inclure ce même inset, sinon
          // le pied de page (CGU, support…) reste caché derrière la nav sur
          // les téléphones à barre de gestes. calc(env()+x), jamais max().
          bottomNav && "pb-[calc(env(safe-area-inset-bottom)+88px)] lg:pb-0"
        )}
      >
        {/* Après une déconnexion, on revenait EN BAS du portail (position de
            défilement restaurée). La connexion doit être la première chose
            visible. */}
        <ScrollToTopOnMount />
        <AuthNavBar variant={navVariant} />
        <div className="flex flex-1 flex-col lg:grid lg:grid-cols-5">
          {/* PANNEAU MARKETING GAUCHE (DESKTOP) — photo + dégradé noir + texte blanc */}
          <aside className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:col-span-2 lg:flex">
            {/* Dégradé de repli (si la photo ne charge pas / hero sans photo) —
                suit le thème « occasion » (vars posées sur <html>, mig 0415). */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(140deg, var(--auth-g1,#6C2BD9) 0%, var(--auth-g2,#5B21B6) 55%, var(--auth-g3,#4C1B9B) 100%)",
              }}
            />
            {hero.imageUrl && (
              <>
                {/* Photo d'ambiance */}
                <div
                  aria-hidden
                  className="absolute inset-0 bg-cover bg-center"
                  style={{ backgroundImage: `url("${hero.imageUrl}")` }}
                />
                {/* Voile noir pour la lisibilité du texte */}
                <div
                  aria-hidden
                  className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/35"
                />
              </>
            )}

            <div className="relative z-10">
              <Logo variant="amber" size="xl" iconOnly className="!gap-0" />
            </div>

            <div className="relative z-10">
              <h1 className="mb-4 text-4xl leading-tight font-bold drop-shadow-md">
                {hero.title}
              </h1>
              <p className="mb-8 text-lg text-white/90 drop-shadow">
                {hero.subtitle}
              </p>

              {hero.stats ? (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {hero.stats.map((s) => (
                    <Stat key={s.label} value={s.value} label={s.label} />
                  ))}
                </div>
              ) : (
                <div className="space-y-4 text-sm">
                  {hero.features?.map((f) => (
                    <Feature key={f} title={f} />
                  ))}
                </div>
              )}
            </div>

            <p className="relative z-10 text-xs text-white/70">
              © {new Date().getFullYear()} {APP_CONFIG.name} ·{" "}
              {isAr ? "جميع الحقوق محفوظة" : "Tous droits réservés"}
            </p>
          </aside>

          {/* PANNEAU FORMULAIRE DROITE */}
          <AuthCard
            modeTabs={modeTabs}
            title={cardTitle}
            subtitle={cardSubtitle}
          >
            {children}
            {footer}
          </AuthCard>
        </div>
        {/* Section MARKETING par rôle (découverte au scroll) — portails
            PARTENAIRES uniquement : ce que chacun gagne sur Coligo, business
            d'abord. Rendue ici pour couvrir les 8 pages sans les modifier. */}
        {/* Application déjà installée → on l'ouvre. Sinon → badge officiel de
            la boutique de l'appareil. Sur TOUS les portails, client compris. */}
        <AppOpenOrInstall />
        {/* L'application MÉTIER (APK Android, hors boutiques) — uniquement
            côté partenaires, et seulement si le portail le concerne. */}
        {navVariant !== "customer" && <PartnerAppCard variant={navVariant} />}
        {navVariant !== "customer" && <PartnerBenefits variant={navVariant} />}
        <AuthFooter showPortal={showPortal} />
        <InstallBanner label={installLabel} className={installClassName} />
      </div>
      {bottomNav}
    </>
  );
}

/** Chiffre-clé du panneau marketing (grille 2×2 : inscription commerçant/client). */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-md bg-black/35 p-3 ring-1 ring-white/15 backdrop-blur">
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-white/80">{label}</div>
    </div>
  );
}

/** Argument à puce verte du panneau marketing (identique au commerçant). */
function Feature({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 drop-shadow">
      <div className="bg-primary-500 flex size-6 shrink-0 items-center justify-center rounded-full ring-2 ring-white/25">
        <svg
          className="size-3.5 text-white"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      <span>{title}</span>
    </div>
  );
}
