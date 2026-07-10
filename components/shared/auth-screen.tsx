import type { ReactNode } from "react";
import { Logo } from "@/components/shared/logo";
import {
  AuthFooter,
  AuthNavBar,
  type AuthVariant,
} from "@/components/shared/auth-nav";
import { InstallBanner } from "@/components/pwa/install-banner";
import { APP_CONFIG } from "@/lib/config/app-config";

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
  showPortal = false,
  modeTabs,
  children,
  footer,
}: {
  navVariant: AuthVariant;
  /** Panneau marketing gauche (desktop only) : photo + titre + arguments. */
  hero: {
    title: ReactNode;
    subtitle: string;
    features: string[];
    imageUrl: string;
  };
  cardTitle: string;
  cardSubtitle: string;
  installLabel: string;
  /** Lien discret vers le portail super-admin (réservé au commerçant). */
  showPortal?: boolean;
  /**
   * Sélecteur « J'ai déjà un compte » / « Je crée mon compte », en TÊTE de la
   * carte. C'est la première chose à lire : elle dit dans quel parcours on est.
   */
  modeTabs?: ReactNode;
  /** Le formulaire de connexion / création de compte. */
  children: ReactNode;
  /** Bloc bas de carte (mot de passe oublié, conditions générales…). */
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <AuthNavBar variant={navVariant} />
      <div className="flex flex-1 flex-col lg:grid lg:grid-cols-5">
        {/* PANNEAU MARKETING GAUCHE (DESKTOP) — photo + dégradé noir + texte blanc */}
        <aside className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:col-span-2 lg:flex">
          {/* Dégradé de repli (si la photo ne charge pas) */}
          <div
            aria-hidden
            className="from-primary-500 via-primary-600 to-primary-800 absolute inset-0 bg-gradient-to-br"
          />
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

            <div className="space-y-4 text-sm">
              {hero.features.map((f) => (
                <Feature key={f} title={f} />
              ))}
            </div>
          </div>

          <p className="relative z-10 text-xs text-white/70">
            © {new Date().getFullYear()} {APP_CONFIG.name} · Tous droits
            réservés
          </p>
        </aside>

        {/* PANNEAU FORMULAIRE DROITE */}
        <main className="bg-surface-2 flex items-center justify-center p-4 py-8 lg:col-span-3 lg:bg-white lg:p-12">
          <div className="w-full max-w-md">
            {/* Logo mobile uniquement */}
            <div className="mb-8 flex justify-center lg:hidden">
              <Logo variant="amber" size="lg" />
            </div>

            {/* CARTE — mobile : bordée/ombrée ; desktop : transparente */}
            <div className="border-border rounded-[14px] border bg-white p-6 shadow-sm lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
              {modeTabs}
              <div className="mb-6">
                <h2 className="text-foreground mb-2 text-2xl font-bold lg:text-3xl">
                  {cardTitle}
                </h2>
                <p className="text-muted text-sm lg:text-base">
                  {cardSubtitle}
                </p>
              </div>

              {children}

              {footer}
            </div>
          </div>
        </main>
      </div>
      <AuthFooter showPortal={showPortal} />
      <InstallBanner label={installLabel} />
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
