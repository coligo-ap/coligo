"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * COMPOSANTS THÉMÉS PARTAGÉS — design system Coligo (cf. docs/design-system.md).
 *
 * RÈGLE D'OR : aucune couleur écrite en dur. Tout passe par les tokens
 * sémantiques globaux (`--color-*`, exposés en utilitaires Tailwind :
 * `bg-surface`, `bg-background`, `text-foreground`, `text-muted`,
 * `border-border`…). Ces tokens ont une valeur claire ET une valeur sombre
 * (cf. app/globals.css : remap `.theme-dark [data-space="client"]`,
 * `.drive-jakarta`, `[data-space="driver"].dark`). Un composant construit avec
 * ces tokens s'adapte donc AUTOMATIQUEMENT au thème — il ne peut pas reproduire
 * le bug « texte clair sur fond clair ».
 *
 * Réutiliser ces composants au lieu de recoder un input / une carte / une
 * feuille à la main : un correctif central = corrigé partout.
 */

/* ───────────────────────── Texte ───────────────────────── */

type TextVariant = "title" | "body" | "muted" | "label";

const TEXT_VARIANT: Record<TextVariant, string> = {
  // Titre : encre principale, semi-gras.
  title: "text-foreground font-bold",
  // Corps : encre principale.
  body: "text-foreground",
  // Secondaire / sous-titre / placeholder textuel : encre atténuée.
  muted: "text-muted",
  // Étiquette de champ : petite, atténuée, semi-grasse.
  label: "text-muted text-[13px] font-semibold",
};

export function AppText({
  as: Tag = "span",
  variant = "body",
  className,
  children,
  ...rest
}: {
  as?: "span" | "p" | "h1" | "h2" | "h3" | "div" | "label";
  variant?: TextVariant;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cn(TEXT_VARIANT[variant], className)} {...rest}>
      {children}
    </Tag>
  );
}

/* ───────────────────────── Carte / surface ───────────────────────── */

export function AppCard({
  className,
  children,
  ...rest
}: {
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-surface text-foreground border-border rounded-2xl border",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ───────────────────────── Champ de saisie ───────────────────────── */

export const AppInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function AppInput({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        // Fond + texte + bordure tokenisés : lisibles dans les deux thèmes.
        // `placeholder:text-subtle` garantit un placeholder contrasté.
        "bg-surface text-foreground border-border placeholder:text-subtle focus:border-primary-500 focus:ring-primary-500/30 w-full rounded-xl border px-3.5 py-2.5 text-[15px] transition outline-none focus:ring-2",
        className
      )}
      {...rest}
    />
  );
});

/* ───────────────────────── Barre de recherche ───────────────────────── */

export const SearchBar = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & {
    icon?: React.ReactNode;
    trailing?: React.ReactNode;
    containerClassName?: string;
  }
>(function SearchBar(
  { icon, trailing, className, containerClassName, ...rest },
  ref
) {
  return (
    <div
      className={cn(
        "bg-surface-2 text-foreground border-border focus-within:border-primary-500 flex items-center gap-2 rounded-2xl border px-3 py-2 transition-colors",
        containerClassName
      )}
    >
      {icon && <span className="text-muted shrink-0">{icon}</span>}
      <input
        ref={ref}
        className={cn(
          "text-foreground placeholder:text-subtle min-w-0 flex-1 bg-transparent text-[15px] outline-none",
          className
        )}
        {...rest}
      />
      {trailing}
    </div>
  );
});

/* ───────────────────────── Bouton ───────────────────────── */

type BtnVariant = "primary" | "secondary" | "ghost";

const BTN_VARIANT: Record<BtnVariant, string> = {
  // Plein violet de marque + texte clair (le seul `text-white` LÉGITIME :
  // sur une surface colorée pleine, jamais sur une surface de thème).
  primary: "bg-primary-600 text-white hover:bg-primary-700",
  // Surface neutre du thème.
  secondary:
    "bg-surface-2 text-foreground border-border border hover:bg-surface-3",
  // Sans fond, encre atténuée.
  ghost: "text-muted hover:text-foreground bg-transparent",
};

export function AppButton({
  variant = "primary",
  className,
  children,
  ...rest
}: {
  variant?: BtnVariant;
  className?: string;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[15px] font-semibold transition disabled:opacity-50",
        BTN_VARIANT[variant],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ───────────────────────── Feuille / bottom-sheet ───────────────────────── */

/**
 * Surface de feuille montante thémée. Le contenu est rendu via un Portal (dans
 * document.body) par l'appelant ; cette surface fixe explicitement `text-` ET
 * `bg-` à partir des tokens — indispensable pour les portails (qui sortent du
 * scope de l'espace), sans quoi le texte hérite d'une couleur de thème pendant
 * que la surface reste claire = libellés invisibles.
 */
export function SheetSurface({
  className,
  children,
  ...rest
}: {
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-surface text-foreground w-full rounded-t-3xl px-5 pt-4 pb-6",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
