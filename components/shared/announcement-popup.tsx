"use client";

import { ArrowRight, Check, ExternalLink, Megaphone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Portal } from "@/components/ui/portal";
import type { Locale } from "@/i18n/locale";

// =============================================================================
// AnnouncementPopup — la pop-up d'annonce (mig 0408), PARTAGÉE entre les 4
// espaces ET l'aperçu en direct de la console admin (prop `preview`).
//
// Ne dépend d'AUCUN provider i18n (les espaces partenaires n'ont pas
// next-intl) : le contenu est bilingue PAR L'ANNONCE, la locale arrive en prop.
// Feuille bas mobile / centrée desktop (pattern du repo), `animate-fade-in`,
// RTL via `dir`. BLOQUANTE : pas de X, overlay inerte — un bouton obligatoire.
// =============================================================================

export type AnnouncementButton = {
  label_fr: string;
  label_ar: string | null;
  action: "acknowledge" | "redirect_internal" | "redirect_external" | "dismiss";
  target?: string | null;
};

export type AnnouncementData = {
  id: string;
  title_fr: string;
  title_ar: string;
  body_fr: string;
  body_ar: string;
  image_url: string | null;
  blocking: boolean;
  buttons: AnnouncementButton[];
};

export type AnnouncementAction =
  | { kind: "close" }
  | { kind: "button"; index: number };

const BUTTON_ICON = {
  acknowledge: Check,
  redirect_internal: ArrowRight,
  redirect_external: ExternalLink,
  dismiss: X,
} as const;

export function AnnouncementPopup({
  announcement,
  locale,
  onAction,
  preview = false,
}: {
  announcement: AnnouncementData;
  locale: Locale;
  onAction: (action: AnnouncementAction) => void;
  /** Aperçu console admin : rend la CARTE seule (pas de Portal/overlay). */
  preview?: boolean;
}) {
  const ar = locale === "ar";
  const title = ar
    ? announcement.title_ar || announcement.title_fr
    : announcement.title_fr;
  const body = ar
    ? announcement.body_ar || announcement.body_fr
    : announcement.body_fr;

  const card = (
    <div
      dir={ar ? "rtl" : "ltr"}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "bg-surface w-full max-w-[420px] overflow-hidden shadow-2xl",
        preview
          ? "rounded-sheet-xl"
          : "animate-fade-in rounded-t-panel-lg sm:rounded-panel-lg"
      )}
    >
      {announcement.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={announcement.image_url}
          alt=""
          className="bg-surface-2 max-h-44 w-full object-cover"
        />
      ) : (
        <div className="from-primary-500 to-primary-700 flex items-center justify-center bg-gradient-to-br py-5">
          <span className="grid size-12 place-items-center rounded-2xl bg-white/15 text-white">
            <Megaphone className="size-6" />
          </span>
        </div>
      )}

      <div className="px-5 pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5">
        <div className="flex items-start gap-2">
          <h2 className="text-foreground text-title-lg min-w-0 flex-1 leading-snug font-extrabold tracking-tight">
            {title}
          </h2>
          {!announcement.blocking && (
            <button
              type="button"
              aria-label="Fermer"
              onClick={() => onAction({ kind: "close" })}
              className="bg-surface-2 text-subtle hover:text-foreground grid size-8 shrink-0 place-items-center rounded-full transition-colors"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <p className="text-muted text-body mt-1.5 leading-relaxed font-medium whitespace-pre-line">
          {body}
        </p>

        {announcement.buttons.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            {announcement.buttons.map((b, i) => {
              const Icon = BUTTON_ICON[b.action] ?? Check;
              const ghost = b.action === "dismiss";
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onAction({ kind: "button", index: i })}
                  className={cn(
                    "rounded-card inline-flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-extrabold transition active:scale-[0.98]",
                    ghost
                      ? "text-muted hover:text-foreground"
                      : "bg-primary-600 hover:bg-primary-700 text-white shadow-[0_8px_20px_-8px_rgba(91,46,255,0.5)]"
                  )}
                >
                  {!ghost && (
                    <Icon
                      className={cn(
                        "size-4",
                        ar && b.action !== "dismiss" && "rtl:-scale-x-100"
                      )}
                    />
                  )}
                  {ar ? b.label_ar || b.label_fr : b.label_fr}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  if (preview) return card;

  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-[97] flex items-end justify-center bg-[rgba(11,11,15,0.5)] p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
        onClick={
          announcement.blocking ? undefined : () => onAction({ kind: "close" })
        }
      >
        {card}
      </div>
    </Portal>
  );
}
