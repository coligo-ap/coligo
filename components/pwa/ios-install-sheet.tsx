"use client";

import { useTranslations } from "next-intl";
import { X } from "lucide-react";

/**
 * Fiche d'installation guidée pour iPhone (Safari). Apple ne propose pas de
 * prompt automatique — il faut accompagner l'utilisateur pas à pas.
 *
 * Réutilisée par `InstallBanner`, `InstallButton` et `InstallAppButton` pour
 * garantir un guide cohérent (et bilingue FR/AR) sur tous les points d'entrée.
 */
export function IosInstallSheet({ onClose }: { onClose: () => void }) {
  const t = useTranslations("install");
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("iosTitle")}
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="border-border w-full max-w-md overflow-hidden rounded-t-[18px] border bg-white shadow-2xl sm:rounded-[18px]"
      >
        {/* Header chaleureux */}
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
            <AppleIcon className="size-5" />
            <h2 className="text-lg font-semibold">{t("iosTitle")}</h2>
          </div>
          <p className="text-primary-100 mt-1 text-sm">{t("iosIntro")}</p>
        </div>

        {/* Mockup Safari illustré */}
        <div className="bg-surface-2 flex items-center justify-center px-5 pt-5 pb-3">
          <SafariBottomBarMockup label={t("iosBar")} />
        </div>

        {/* Étapes */}
        <ol className="space-y-3 px-5 pb-5 text-sm">
          {[t("iosStep1"), t("iosStep2"), t("iosStep3")].map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <Step n={i + 1} />
              <div className="flex-1 pt-0.5">{step}</div>
            </li>
          ))}
        </ol>

        {/* Note honnête sur les notifs iOS */}
        <div className="border-border bg-primary-50/60 border-t px-5 py-3 text-xs">
          <p className="text-primary-900">{t("iosTip")}</p>
        </div>

        <div className="border-border border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="bg-primary-600 hover:bg-primary-700 inline-flex h-10 w-full items-center justify-center rounded-[10px] px-5 text-sm font-medium text-white"
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

/** Logo Apple — pour signaler clairement « iPhone ». */
export function AppleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.953 4.45z" />
    </svg>
  );
}

/** Icône Share iOS (carré + flèche montante) — plus reconnaissable que le triangle Lucide. */
function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3v13" />
      <path d="m7 8 5-5 5 5" />
      <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7" />
    </svg>
  );
}

/**
 * Mockup simplifié du bas de Safari iOS pour situer l'icône Partager.
 * Pure CSS/SVG — pas d'asset à charger.
 */
function SafariBottomBarMockup({ label }: { label: string }) {
  return (
    <div className="border-border w-full max-w-xs rounded-[16px] border bg-white p-3 shadow-sm">
      {/* Barre URL Safari */}
      <div className="bg-surface-2 mb-3 flex items-center gap-2 rounded-full px-3 py-2 text-xs">
        <span className="bg-success-500 inline-block size-1.5 rounded-full" />
        <span className="text-muted truncate font-medium">coligo.app</span>
      </div>

      {/* Barre d'actions Safari (avec l'icône Share au milieu, encadrée) */}
      <div className="text-muted flex items-center justify-between px-2">
        <ChevronIcon dir="left" />
        <ChevronIcon dir="right" />
        <div className="border-primary-400 bg-primary-50 ring-primary-200 -m-1 inline-flex size-9 animate-pulse items-center justify-center rounded-[10px] border-2 ring-4">
          <ShareIcon className="text-primary-700 size-4" />
        </div>
        <BookIcon />
        <TabsIcon />
      </div>
      <p className="text-muted mt-2 text-center text-[11px]">{label}</p>
    </div>
  );
}

function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 opacity-60"
      aria-hidden="true"
    >
      {dir === "left" ? (
        <path d="m15 18-6-6 6-6" />
      ) : (
        <path d="m9 18 6-6-6-6" />
      )}
    </svg>
  );
}

function BookIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 opacity-60"
      aria-hidden="true"
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </svg>
  );
}

function TabsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 opacity-60"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <rect x="7" y="7" width="14" height="14" rx="2" />
    </svg>
  );
}
