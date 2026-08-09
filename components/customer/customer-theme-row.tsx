"use client";

import { useEffect, useState } from "react";
import { Moon } from "lucide-react";
import { setTheme } from "@/lib/theme/actions";
import { Toggle } from "@/components/ui/toggle";

/**
 * Rangée « Apparence » de la page Compte client — c'est désormais LE point
 * d'accès au mode sombre sur mobile.
 *
 * Avant, la bascule vivait dans le header de l'accueil (`ThemeSwitcher`), où
 * elle occupait un des six contrôles d'une barre qui n'a de place que pour les
 * gestes FRÉQUENTS (zone, notifications, panier). Un réglage d'apparence se
 * change une fois : sa place est dans les préférences du compte, à côté de la
 * langue. Le header desktop la garde (il n'y a pas de barre du bas là-bas).
 *
 * Mécanique reprise à l'identique de ThemeSwitcher : bascule INSTANTANÉE par
 * la classe `theme-dark` sur <html> (le thème est piloté 100 % en CSS), cookie
 * persisté en arrière-plan (fire-and-forget) — jamais de `router.refresh()`,
 * qui re-rendrait tout le RSC pour un changement déjà visible.
 */
export function CustomerThemeRow({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  // Lu depuis le DOM (classe posée par le layout racine) → aucun décalage
  // SSR/client : on n'affiche l'état qu'après montage.
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("theme-dark"));
  }, []);

  const apply = (next: boolean) => {
    setDark(next);
    document.documentElement.classList.toggle("theme-dark", next);
    void setTheme(next ? "dark" : "light");
  };

  return (
    <div className="flex w-full items-center gap-3 px-4 py-3.5">
      <span className="bg-primary-50 text-primary-600 grid size-10 shrink-0 place-items-center rounded-xl">
        <Moon className="size-[19px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground text-title-sm block font-extrabold tracking-tight">
          {title}
        </span>
        <span className="text-muted text-label-lg block">{subtitle}</span>
      </span>
      <Toggle
        checked={dark === true}
        disabled={dark === null}
        onChange={apply}
        label={title}
      />
    </div>
  );
}
