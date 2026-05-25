"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { useInstallPrompt } from "@/lib/pwa/use-install-prompt";
import { cn } from "@/lib/utils";
import { IosInstallSheet } from "./ios-install-sheet";

type Variant = "inline" | "nav";

/**
 * Bouton « Installer l'app » qui s'auto-cache si déjà installée ou impossible.
 *
 * - variant `"inline"` : pour les pages publiques (login, signup), discret.
 * - variant `"nav"` : pour le drawer / menus, alignement type item de nav.
 * - sur iOS, ouvre la fiche guidée `IosInstallSheet` (Partager → Sur l'écran
 *   d'accueil) puisqu'aucune API web ne déclenche l'install directe.
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
        <IosInstallSheet onClose={() => setShowIosCard(false)} />
      )}
    </>
  );
}
