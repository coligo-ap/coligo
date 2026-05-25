"use client";

import { Plus, X } from "lucide-react";

/**
 * Fiche d'installation guidée pour iPhone (Safari). Apple ne propose pas de
 * prompt automatique — il faut accompagner l'utilisateur pas à pas.
 *
 * Réutilisée par `InstallBanner` et `InstallButton` pour garantir un guide
 * cohérent sur tous les points d'entrée.
 */
export function IosInstallSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Installer Coligo sur l'écran d'accueil"
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
            aria-label="Fermer"
            className="absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
          <h2 className="text-lg font-semibold">
            Installez Coligo sur votre iPhone
          </h2>
          <p className="text-primary-100 mt-1 text-sm">
            En 3 secondes : icône sur l&apos;écran d&apos;accueil, ouverture
            instantanée, alertes plus visibles. Comme une vraie app.
          </p>
        </div>

        {/* Mockup Safari illustré */}
        <div className="bg-surface-2 flex items-center justify-center px-5 pt-5 pb-3">
          <SafariBottomBarMockup />
        </div>

        {/* Étapes */}
        <ol className="space-y-3 px-5 pb-5 text-sm">
          <li className="flex items-start gap-3">
            <Step n={1} />
            <div className="flex-1 pt-0.5">
              Appuyez sur <strong>l&apos;icône Partager</strong>
              <ShareIcon className="text-primary-600 ms-1 inline-block size-4 align-text-bottom" />
              en bas de Safari (au milieu de la barre).
            </div>
          </li>
          <li className="flex items-start gap-3">
            <Step n={2} />
            <div className="flex-1 pt-0.5">
              Faites défiler et choisissez{" "}
              <strong>&laquo; Sur l&apos;écran d&apos;accueil &raquo;</strong>
              <Plus className="text-primary-600 ms-1 inline-block size-4 align-text-bottom" />
              .
            </div>
          </li>
          <li className="flex items-start gap-3">
            <Step n={3} />
            <div className="flex-1 pt-0.5">
              Validez avec <strong>&laquo; Ajouter &raquo;</strong> en haut à
              droite.
            </div>
          </li>
        </ol>

        {/* Note honnête sur les notifs iOS */}
        <div className="border-border bg-primary-50/60 border-t px-5 py-3 text-xs">
          <p className="text-primary-900">
            <strong>Astuce :</strong> une fois Coligo installée, lancez-la
            depuis l&apos;icône sur votre écran d&apos;accueil — c&apos;est
            requis par iOS pour recevoir les notifications de nouvelles
            commandes.
          </p>
        </div>

        <div className="border-border border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="bg-primary-600 hover:bg-primary-700 inline-flex h-10 w-full items-center justify-center rounded-[10px] px-5 text-sm font-medium text-white"
          >
            Compris
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
function SafariBottomBarMockup() {
  return (
    <div className="border-border w-full max-w-xs rounded-[16px] border bg-white p-3 shadow-sm">
      {/* Barre URL Safari */}
      <div className="bg-surface-2 mb-3 flex items-center gap-2 rounded-full px-3 py-2 text-xs">
        <span className="bg-success-500 inline-block size-1.5 rounded-full" />
        <span className="text-muted truncate font-medium">
          commercant.coligo.app
        </span>
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
      <p className="text-muted mt-2 text-center text-[11px]">
        Bouton <strong>Partager</strong> dans Safari
      </p>
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
