"use client";

import { useTranslations } from "next-intl";
import { MoreVertical, SquarePlus, X } from "lucide-react";

/**
 * Fiche d'installation guidée pour Android — affichée UNIQUEMENT en repli,
 * quand le navigateur ne fournit pas le prompt natif `beforeinstallprompt`
 * (Firefox Android, certains navigateurs in-app, etc.). Sur Chrome/Edge/Brave,
 * le tap déclenche directement l'installation et cette fiche n'apparaît jamais.
 */
export function AndroidInstallSheet({ onClose }: { onClose: () => void }) {
  const t = useTranslations("install");
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("androidTitle")}
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="border-border rounded-t-sheet-lg sm:rounded-sheet-lg shadow-overlay w-full max-w-md overflow-hidden border bg-white pb-[env(safe-area-inset-bottom)] sm:pb-0"
      >
        <div className="from-primary-600 to-primary-700 relative bg-gradient-to-br p-5 text-white">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
          <div className="flex items-center gap-2">
            <AndroidIcon className="size-5" />
            <h2 className="text-lg font-semibold">{t("androidTitle")}</h2>
          </div>
          <p className="text-primary-100 mt-1 text-sm">{t("androidIntro")}</p>
        </div>

        {/* Mockup barre du navigateur avec le menu ⋮ encadré */}
        <div className="bg-surface-2 flex items-center justify-center px-5 pt-5 pb-3">
          <BrowserMenuMockup label={t("androidMenu")} />
        </div>

        <ol className="space-y-3 px-5 pb-5 text-sm">
          {[t("androidStep1"), t("androidStep2"), t("androidStep3")].map(
            (step, i) => (
              <li key={i} className="flex items-start gap-3">
                <Step n={i + 1} />
                <div className="flex-1 pt-0.5">{step}</div>
              </li>
            )
          )}
        </ol>

        <div className="border-border border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="bg-primary-600 hover:bg-primary-700 rounded-control inline-flex h-10 w-full items-center justify-center px-5 text-sm font-medium text-white"
          >
            {t("done")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="bg-primary-100 text-primary-700 mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold">
      {n}
    </span>
  );
}

/** Logo robot Android — pour signaler clairement « Android ». */
export function AndroidIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85a.637.637 0 0 0-.83.22l-1.88 3.24a11.43 11.43 0 0 0-8.94 0L5.65 5.67a.643.643 0 0 0-.87-.2c-.28.18-.37.54-.22.83L6.4 9.48A10.78 10.78 0 0 0 1 18h22a10.78 10.78 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z" />
    </svg>
  );
}

/** Mockup de la barre du navigateur Android avec le menu ⋮ mis en évidence. */
function BrowserMenuMockup({ label }: { label: string }) {
  return (
    <div className="border-border w-full max-w-xs rounded-lg border bg-white p-3">
      <div className="flex items-center gap-2">
        <div className="bg-surface-2 flex flex-1 items-center gap-2 rounded-full px-3 py-2 text-xs">
          <span className="bg-success-500 inline-block size-1.5 rounded-full" />
          <span className="text-muted truncate font-medium">coligo.app</span>
        </div>
        <div className="border-primary-400 bg-primary-50 ring-primary-200 text-primary-700 rounded-control inline-flex size-9 animate-pulse items-center justify-center border-2 ring-4">
          <MoreVertical className="size-4" />
        </div>
      </div>
      <div className="text-muted text-caption mt-3 flex items-center justify-center gap-1.5">
        <SquarePlus className="text-primary-600 size-3.5" />
        <span>{label}</span>
      </div>
    </div>
  );
}
