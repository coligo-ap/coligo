"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Globe } from "lucide-react";
import { setLocale } from "@/i18n/actions";
import { LOCALES, type Locale } from "@/i18n/locale";
import { cn } from "@/lib/utils";

/**
 * Bascule de langue FR / ع. Pose le cookie `NEXT_LOCALE` via l'action serveur
 * puis rafraîchit la route → re-rendu avec la nouvelle locale + direction RTL.
 */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const active = useLocale() as Locale;
  const router = useRouter();
  const [pending, start] = useTransition();

  const choose = (next: Locale) => {
    if (next === active || pending) return;
    start(async () => {
      await setLocale(next);
      router.refresh();
    });
  };

  const labels: Record<Locale, string> = { fr: "FR", ar: "ع" };

  return (
    <div
      className={cn(
        "border-border bg-surface inline-flex shrink-0 items-center rounded-full border p-0.5",
        pending && "opacity-60"
      )}
      role="group"
      aria-label="Langue"
    >
      {!compact && <Globe className="text-muted mx-1.5 size-3.5" />}
      {LOCALES.map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => choose(loc)}
          aria-pressed={active === loc}
          className={cn(
            "min-w-[28px] rounded-full px-2 py-1 text-[12px] font-bold transition-colors",
            active === loc
              ? "bg-foreground text-white"
              : "text-muted hover:text-foreground"
          )}
        >
          {labels[loc]}
        </button>
      ))}
    </div>
  );
}
