"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Check, ChevronDown } from "lucide-react";
import { setLocale } from "@/i18n/actions";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locale";
import { LocaleFlag } from "@/components/i18n/locale-flag";
import { cn } from "@/lib/utils";

/**
 * Sélecteur de langue — liste déroulante SANS CADRE : un simple déclencheur
 * (globe + langue courante + chevron) qui se déplie VERS LE BAS au clic et
 * affiche toutes les langues. Pose le cookie `NEXT_LOCALE` via l'action serveur
 * puis rafraîchit la route → re-rendu avec la nouvelle locale + direction RTL.
 */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const active = useLocale() as Locale;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Fermeture au clic en dehors / touche Échap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (next: Locale) => {
    setOpen(false);
    if (next === active || pending) return;
    start(async () => {
      await setLocale(next);
      router.refresh();
    });
  };

  // Code court pour le déclencheur (compact) : FR / ع / EN.
  const shortLabel: Record<Locale, string> = { fr: "FR", ar: "ع", en: "EN" };

  return (
    <div ref={ref} className="relative inline-block shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Langue"
        className={cn(
          // SANS cadre : pas de bordure ni de fond, juste le texte + chevron.
          "text-muted hover:text-foreground inline-flex items-center gap-1.5 bg-transparent px-1 py-1 text-[13px] font-semibold transition-colors",
          pending && "opacity-60"
        )}
      >
        <LocaleFlag locale={active} className="w-5 shrink-0" />
        <span>{compact ? shortLabel[active] : LOCALE_LABELS[active]}</span>
        <ChevronDown
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="border-border bg-surface absolute end-0 top-full z-50 mt-1 min-w-[150px] overflow-hidden rounded-xl border py-1 shadow-lg"
        >
          {LOCALES.map((loc) => (
            <li key={loc}>
              <button
                type="button"
                role="option"
                aria-selected={active === loc}
                onClick={() => choose(loc)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-start text-[13px] transition-colors",
                  active === loc
                    ? "text-foreground font-bold"
                    : "text-muted hover:text-foreground hover:bg-surface-2"
                )}
              >
                <LocaleFlag locale={loc} className="w-5 shrink-0" />
                <span className="min-w-0 flex-1">{LOCALE_LABELS[loc]}</span>
                {active === loc && (
                  <Check className="text-primary-600 size-4 shrink-0" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
