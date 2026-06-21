"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { setTheme } from "@/lib/theme/actions";
import { VIOLET } from "@/components/customer/drive/drive-modals";

/**
 * Bascule clair / sombre CHAUFFEUR, accessible depuis l'en-tête de l'accueil
 * (plus besoin d'aller dans Compte). Instantané : on toggle la classe
 * `theme-dark` (le thème chauffeur est piloté par CSS sur `.drive-jakarta`) et on
 * persiste le cookie en arrière-plan — PAS de router.refresh().
 */
export function ChauffeurDarkPill({ className }: { className?: string }) {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("theme-dark"));
  }, []);

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
      aria-label={dark ? "Mode clair" : "Mode sombre"}
      aria-pressed={dark === true}
      className={
        "grid size-[44px] place-items-center rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow-lg " +
        (className ?? "")
      }
      style={{ color: VIOLET }}
    >
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}
