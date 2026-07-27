import type { ReactNode } from "react";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";

/**
 * La carte de formulaire des écrans d'authentification, pour TOUS les portails.
 *
 * Elle existe pour qu'il n'y ait qu'UN seul endroit où régler l'espacement
 * vertical. Auparavant, six pages passaient par `AuthScreen` et quatre autres
 * (commerçant, client) recopiaient le même markup : resserrer l'une laissait les
 * autres respirer.
 *
 * MOBILE — style « soft organic minimal » (réf. maquette 9973) : héro violet à
 * formes organiques (blobs marque) + texture grain, titre centré blanc, puis
 * FEUILLE blanche arrondie qui chevauche le héro et porte le formulaire.
 * Animations 100 % CSS (blobs flottants, entrée de la feuille), coupées par
 * `prefers-reduced-motion`. Le logo n'est PAS répété ici : le bandeau d'auth
 * au-dessus le porte déjà.
 *
 * DESKTOP — inchangé : la carte se fond dans le panneau droit, titre en tête.
 *
 * L'échelle reste délibérément serrée — l'écran de connexion doit tenir sans
 * défilement sur un mobile standard (390 × 844) et aucune cible tactile ne
 * descend sous 44 px (onglets et champs imposent leur hauteur).
 */

/** Texture grain inline (feTurbulence) — zéro requête réseau, CSP-safe. */
const GRAIN =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

const AUTH_CARD_CSS = `
@keyframes authBlobA{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(10px,14px,0) scale(1.08)}}
@keyframes authBlobB{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(-12px,-10px,0) scale(1.06)}}
@keyframes authHeroIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes authSheetIn{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
.auth-blob-a{animation:authBlobA 11s ease-in-out infinite alternate}
.auth-blob-b{animation:authBlobB 13s ease-in-out infinite alternate}
.auth-blob-c{animation:authBlobA 9s ease-in-out infinite alternate-reverse}
.auth-hero-in{animation:authHeroIn .4s ease-out}
.auth-sheet-in{animation:authSheetIn .45s cubic-bezier(.22,.9,.36,1)}
@media (prefers-reduced-motion:reduce){.auth-blob-a,.auth-blob-b,.auth-blob-c,.auth-hero-in,.auth-sheet-in{animation:none}}
`;

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
    <main className="bg-surface-2 flex flex-col lg:col-span-3 lg:items-center lg:justify-center lg:bg-white lg:p-10">
      <style>{AUTH_CARD_CSS}</style>

      {/* HÉRO MOBILE — violet marque, blobs organiques + grain, titre centré. */}
      <div className="relative overflow-hidden px-6 pt-6 pb-14 text-center text-white lg:hidden">
        <div
          aria-hidden
          className="from-primary-600 via-primary-700 to-primary-800 absolute inset-0 bg-gradient-to-br"
        />
        {/* Blobs marque : violet clair + rose Coligo + halo blanc. */}
        <div
          aria-hidden
          className="auth-blob-a absolute -top-12 -left-10 size-44 rounded-full bg-[#8A4DFF]/70"
        />
        <div
          aria-hidden
          className="auth-blob-b absolute -right-12 -bottom-20 size-52 rounded-full bg-[#FF2D7A]/55"
        />
        <div
          aria-hidden
          className="auth-blob-c absolute top-5 right-1/4 size-14 rounded-full bg-white/15"
        />
        {/* Grain par-dessus les formes (texture « organic minimal »). */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.16] mix-blend-overlay"
          style={{ backgroundImage: `url("${GRAIN}")` }}
        />
        <div className="auth-hero-in relative z-10">
          <h2 className="text-[22px] leading-tight font-bold drop-shadow-sm">
            {title}
          </h2>
          <p className="mx-auto mt-1 max-w-xs text-[13px] leading-snug text-white/85">
            {subtitle}
          </p>
        </div>
      </div>

      {/* FEUILLE FORMULAIRE — chevauche le héro (mobile) ; desktop : fondue. */}
      <div className="relative z-10 -mt-9 w-full max-w-md self-center px-4 pb-6 lg:mt-0 lg:px-0 lg:pb-0">
        <div className="auth-sheet-in rounded-[24px] bg-white p-5 shadow-[0_18px_50px_-20px_rgba(76,27,155,0.45)] lg:rounded-none lg:bg-transparent lg:p-0 lg:shadow-none">
          {/* Langue (mobile) — le titre, lui, vit dans le héro. */}
          <div className="-mt-1 mb-2 flex justify-end lg:hidden">
            <LanguageSwitcher compact />
          </div>
          {modeTabs}
          {/* Titre + sélecteur de langue (desktop uniquement). */}
          <div className="mb-3 hidden items-start justify-between gap-3 lg:flex">
            <div className="min-w-0">
              <h2 className="text-foreground mb-1 text-2xl font-bold">
                {title}
              </h2>
              <p className="text-muted text-sm leading-snug">{subtitle}</p>
            </div>
            <LanguageSwitcher compact />
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
