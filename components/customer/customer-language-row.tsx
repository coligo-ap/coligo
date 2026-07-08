"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Check, ChevronDown, Globe } from "lucide-react";
import { setLocale } from "@/i18n/actions";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locale";
import { cn } from "@/lib/utils";

/**
 * Rangée « Langue » de la page Compte client — LISTE OUVRANTE/FERMANTE, même
 * principe que le sélecteur du header marketplace (LanguageSwitcher) : la
 * rangée affiche la langue courante (« Français ») + chevron ; un tap déplie
 * la liste des langues SOUS la rangée (dépliage dans la carte — la carte a
 * `overflow-hidden`, un menu flottant serait rogné). Choisir une langue
 * ENREGISTRE le choix (cookie NEXT_LOCALE, 1 an) via l'action serveur puis
 * rafraîchit la route pour appliquer la nouvelle locale + direction RTL.
 * Style aligné sur MenuRow / CustomerSupportRow.
 */
export function CustomerLanguageRow({ title }: { title: string }) {
  const active = useLocale() as Locale;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const choose = (next: Locale) => {
    setOpen(false);
    if (next === active || pending) return;
    start(async () => {
      await setLocale(next);
      router.refresh();
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-expanded={open}
        aria-label={title}
        className="hover:bg-surface-2 flex w-full items-center gap-3 px-4 py-3.5 text-start transition-colors disabled:opacity-60"
      >
        <span className="bg-primary-50 text-primary-600 grid size-10 shrink-0 place-items-center rounded-xl">
          <Globe className="size-[19px]" />
        </span>
        <span className="text-foreground min-w-0 flex-1 text-[15px] font-extrabold tracking-tight">
          {title}
        </span>
        <span className="text-muted inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold">
          {LOCALE_LABELS[active]}
          <ChevronDown
            className={cn("size-4 transition-transform", open && "rotate-180")}
          />
        </span>
      </button>

      {open && (
        <ul role="listbox" className="border-border border-t py-1">
          {LOCALES.map((loc) => (
            <li key={loc}>
              <button
                type="button"
                role="option"
                aria-selected={active === loc}
                onClick={() => choose(loc)}
                disabled={pending}
                className={cn(
                  "flex w-full items-center justify-between gap-3 py-2.5 ps-[68px] pe-4 text-start text-[14px] transition-colors disabled:opacity-60",
                  active === loc
                    ? "text-foreground font-bold"
                    : "text-muted hover:text-foreground hover:bg-surface-2"
                )}
              >
                {LOCALE_LABELS[loc]}
                {active === loc && (
                  <Check className="text-primary-600 size-4" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
