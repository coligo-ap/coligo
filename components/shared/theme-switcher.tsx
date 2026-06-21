"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { setTheme } from "@/lib/theme/actions";

/**
 * Bascule clair / sombre (header, à côté du sélecteur de langue). Le sombre
 * ne suit PLUS le réglage système : c'est un choix explicite, persisté en
 * cookie.
 *
 * PERF : la bascule est INSTANTANÉE — on toggle la classe `theme-dark` sur
 * <html> (le thème est piloté 100 % par CSS) et on persiste le cookie en
 * arrière-plan (fire-and-forget). PLUS de `router.refresh()` : le rafraîchissement
 * RSC complet rendait le bouton lent/grisé pour rien (le visuel est déjà à jour ;
 * le cookie suffit pour que le prochain chargement SSR soit cohérent).
 */
export function ThemeSwitcher() {
  // Lu depuis le DOM (classe posée par le layout racine) — évite tout
  // décalage SSR/client : on n'affiche l'état qu'après montage.
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("theme-dark"));
  }, []);

  const toggle = () => {
    if (dark === null) return;
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("theme-dark", next);
    // Persistance cookie en arrière-plan — ne bloque jamais l'UI.
    void setTheme(next ? "dark" : "light");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Mode clair" : "Mode sombre"}
      aria-pressed={dark === true}
      className="border-border bg-surface text-muted hover:text-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-full border"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
