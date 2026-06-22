"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Globe } from "lucide-react";
import { setLocale } from "@/i18n/actions";
import { cn } from "@/lib/utils";

/**
 * Rangée « Langue » de la page Compte client : un tap bascule FR ⇄ AR et
 * ENREGISTRE le choix (cookie NEXT_LOCALE, 1 an) via l'action serveur, puis
 * rafraîchit la route pour appliquer la nouvelle locale + direction RTL. Style
 * aligné sur MenuRow / CustomerSupportRow. Le segment FR/ع montre la langue
 * active d'un coup d'œil.
 */
export function CustomerLanguageRow({ title }: { title: string }) {
  const isAr = useLocale() === "ar";
  const router = useRouter();
  const [pending, start] = useTransition();
  const toggle = () =>
    start(async () => {
      await setLocale(isAr ? "fr" : "ar");
      router.refresh();
    });
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-label={title}
      className="hover:bg-surface-2 flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors disabled:opacity-60"
    >
      <span className="bg-primary-50 text-primary-600 grid size-10 shrink-0 place-items-center rounded-xl">
        <Globe className="size-[19px]" />
      </span>
      <span className="text-foreground min-w-0 flex-1 text-[15px] font-extrabold tracking-tight">
        {title}
      </span>
      <span className="bg-surface-2 inline-flex shrink-0 items-center gap-0.5 rounded-full p-0.5 text-xs font-bold">
        <span
          className={cn(
            "rounded-full px-2.5 py-1 transition-colors",
            !isAr ? "text-foreground bg-white shadow-sm" : "text-muted"
          )}
        >
          FR
        </span>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 transition-colors",
            isAr ? "text-foreground bg-white shadow-sm" : "text-muted"
          )}
        >
          ع
        </span>
      </span>
    </button>
  );
}
