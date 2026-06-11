"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { setTheme } from "@/lib/theme/actions";
import { cn } from "@/lib/utils";

/**
 * Bascule clair / sombre (header, à côté du sélecteur de langue). Le sombre
 * ne suit PLUS le réglage système : c'est un choix explicite, persisté en
 * cookie. La classe `theme-dark` est togglée immédiatement sur <html> pour
 * un retour visuel instantané, puis la route est rafraîchie (SSR cohérent).
 */
export function ThemeSwitcher() {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Lu depuis le DOM (classe posée par le layout racine) — évite tout
  // décalage SSR/client : on n'affiche l'état qu'après montage.
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("theme-dark"));
  }, []);

  const toggle = () => {
    if (pending || dark === null) return;
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("theme-dark", next);
    start(async () => {
      await setTheme(next ? "dark" : "light");
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Mode clair" : "Mode sombre"}
      aria-pressed={dark === true}
      className={cn(
        "border-border bg-surface text-muted hover:text-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-full border",
        pending && "opacity-60"
      )}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
