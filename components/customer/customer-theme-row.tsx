"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { setTheme } from "@/lib/theme/actions";
import { cn } from "@/lib/utils";

/**
 * Rangée « Mode sombre » de la page Compte client — même gabarit que
 * CustomerLanguageRow / MenuRow (pastille d'icône + titre + valeur à droite),
 * avec un interrupteur PLAT (pas d'ombre, pas de dégradé).
 *
 * C'est LA SEULE porte du mode sombre côté client (décision produit du
 * 10/08/2026) : l'app s'ouvre TOUJOURS en clair par défaut — elle ne suit
 * jamais le réglage sombre du téléphone (le thème est piloté par notre cookie,
 * pas par prefers-color-scheme) — et la lune a été retirée du header. Le choix
 * fait ici est persisté (cookie 1 an) et survit aux réouvertures.
 *
 * Bascule INSTANTANÉE (même mécanique que ThemeSwitcher) : on toggle la classe
 * `theme-dark` sur <html> — le thème est piloté 100 % en CSS — et le cookie est
 * persisté en arrière-plan. Aucun `router.refresh()` : le visuel est déjà à
 * jour, le cookie ne sert qu'à la cohérence du prochain rendu SSR.
 */
export function CustomerThemeRow({ title }: { title: string }) {
  // Lu depuis le DOM après montage (classe posée par le layout racine) — évite
  // tout écart SSR/client (hydratation) sur une page rendue au serveur.
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("theme-dark"));
  }, []);

  const on = dark === true;

  const toggle = () => {
    if (dark === null) return;
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("theme-dark", next);
    void setTheme(next ? "dark" : "light");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={on}
      aria-label={title}
      className="hover:bg-surface-2 flex w-full items-center gap-3 px-4 py-3.5 text-start transition-colors"
    >
      <span className="bg-primary-50 text-primary-600 grid size-10 shrink-0 place-items-center rounded-xl">
        {on ? (
          <Moon className="size-[19px]" />
        ) : (
          <Sun className="size-[19px]" />
        )}
      </span>
      <span className="text-foreground text-title-sm min-w-0 flex-1 font-extrabold tracking-tight">
        {title}
      </span>
      {/* Interrupteur : le curseur est un ENFANT FLEX aligné en début/fin —
          pas un `translate-x` — donc correct en RTL (arabe) sans variante. */}
      <span
        className={cn(
          "flex h-6 w-11 shrink-0 items-center rounded-full border px-[3px] transition-colors",
          on
            ? "bg-primary-600 border-primary-600 justify-end"
            : "bg-surface-2 border-border justify-start"
        )}
      >
        <span className="size-[18px] rounded-full bg-white" />
      </span>
    </button>
  );
}
