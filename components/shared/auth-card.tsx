import type { ReactNode } from "react";
import { Logo } from "@/components/shared/logo";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";

/**
 * La carte de formulaire des écrans d'authentification, pour TOUS les portails.
 *
 * Elle existe pour qu'il n'y ait qu'UN seul endroit où régler l'espacement
 * vertical. Auparavant, six pages passaient par `AuthScreen` et quatre autres
 * (commerçant, client) recopiaient le même markup : resserrer l'une laissait les
 * autres respirer.
 *
 * L'échelle est délibérément serrée — l'écran de connexion doit tenir sans
 * défilement sur un mobile standard (390 × 844). Elle reste lisible : le
 * sous-titre garde son `leading-snug`, et aucune cible tactile ne descend sous
 * 44 px (les onglets et les champs imposent leur propre hauteur).
 */
export function AuthCard({
  modeTabs,
  title,
  subtitle,
  children,
}: {
  /** `<AuthModeTabs>` — en tête de carte, avant le titre. */
  modeTabs?: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  /** Le formulaire, et ce qui le suit (OAuth, liens de bas de carte…). */
  children: ReactNode;
}) {
  return (
    <main className="bg-surface-2 flex items-center justify-center p-4 py-6 lg:col-span-3 lg:bg-white lg:p-10">
      <div className="w-full max-w-md">
        {/* Logo mobile uniquement : en desktop, le panneau de gauche le porte. */}
        <div className="mb-4 flex justify-center lg:hidden">
          <Logo variant="amber" size="lg" />
        </div>

        {/* Mobile : carte bordée. Desktop : elle se fond dans le panneau. */}
        <div className="border-border rounded-[14px] border bg-white p-5 shadow-sm lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
          {modeTabs}
          {/* Titre + sélecteur de langue (FR ⇄ AR) — présent sur TOUS les
              portails d'auth : client, livreur, chauffeur, commerçant, Agent. */}
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-foreground mb-1 text-xl font-bold lg:text-2xl">
                {title}
              </h2>
              <p className="text-muted text-[13px] leading-snug lg:text-sm">
                {subtitle}
              </p>
            </div>
            <LanguageSwitcher compact />
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
