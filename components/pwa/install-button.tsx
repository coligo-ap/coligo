"use client";

import { useState } from "react";
import { Download, Share2, Plus, X } from "lucide-react";
import { useInstallPrompt } from "@/lib/pwa/use-install-prompt";
import { cn } from "@/lib/utils";

type Variant = "inline" | "nav";

/**
 * Bouton « Installer l'app » qui s'auto-cache si déjà installée ou impossible.
 *
 * - variant `"inline"` : pour les pages publiques (login, signup), discret.
 * - variant `"nav"` : pour le drawer / menus, alignement type item de nav.
 * - sur iOS, ouvre une mini fiche d'instructions (Partager → Sur l'écran d'accueil)
 *   puisqu'aucune API web ne déclenche l'install directe.
 */
export function InstallButton({
  variant = "inline",
  onAfterPrompt,
}: {
  variant?: Variant;
  onAfterPrompt?: () => void;
}) {
  const { canInstall, isIos, prompt } = useInstallPrompt();
  const [showIosCard, setShowIosCard] = useState(false);

  if (!canInstall) return null;

  async function handleClick() {
    const res = await prompt();
    if (res === "ios") setShowIosCard(true);
    onAfterPrompt?.();
  }

  return (
    <>
      {variant === "nav" ? (
        <button
          type="button"
          onClick={handleClick}
          className="text-muted hover:bg-surface-2 hover:text-foreground flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 py-2 text-sm transition-colors"
        >
          <Download className="size-5 shrink-0" />
          <span className="flex-1 text-left">Installer l&apos;application</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            "border-primary-200 text-primary-700 hover:bg-primary-50 inline-flex h-9 items-center gap-2 rounded-[10px] border bg-white px-3 text-sm font-medium transition-colors"
          )}
        >
          <Download className="size-4" />
          Installer l&apos;app
        </button>
      )}

      {showIosCard && isIos && (
        <IosInstallCard onClose={() => setShowIosCard(false)} />
      )}
    </>
  );
}

function IosInstallCard({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Installer Coligo sur l'écran d'accueil"
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="border-border w-full max-w-sm rounded-t-[16px] border bg-white p-5 shadow-xl sm:rounded-[16px]"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">
            Installer sur l&apos;écran d&apos;accueil
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="text-muted hover:bg-surface-2 hover:text-foreground flex size-8 items-center justify-center rounded-full"
          >
            <X className="size-4" />
          </button>
        </div>

        <ol className="text-foreground space-y-3 text-sm">
          <li className="flex items-start gap-3">
            <span className="bg-primary-50 text-primary-700 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
              1
            </span>
            <span className="flex items-center gap-1.5">
              Appuyez sur
              <Share2 className="text-primary-600 size-4" />
              <span className="font-medium">Partager</span> en bas de Safari.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="bg-primary-50 text-primary-700 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
              2
            </span>
            <span className="flex items-center gap-1.5">
              Choisissez
              <Plus className="text-primary-600 size-4" />
              <span className="font-medium">
                Sur l&apos;écran d&apos;accueil
              </span>
              .
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="bg-primary-50 text-primary-700 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
              3
            </span>
            <span>Confirmez avec « Ajouter ».</span>
          </li>
        </ol>
      </div>
    </div>
  );
}
