"use client";

import { Download, X } from "lucide-react";
import { useInstallPrompt } from "@/lib/pwa/use-install-prompt";
import { useState } from "react";
import { IosInstallSheet } from "./ios-install-sheet";

/**
 * Bandeau bas non intrusif qui propose d'installer l'app.
 * Auto-caché si déjà installée, déjà refusée (< 14j) ou installation impossible.
 */
export function InstallBanner() {
  const { canInstall, isIos, dismissed, prompt, dismiss } = useInstallPrompt();
  const [iosOpen, setIosOpen] = useState(false);

  if (!canInstall || dismissed) return null;

  async function handle() {
    const res = await prompt();
    if (res === "ios") setIosOpen(true);
  }

  return (
    <>
      <div className="fixed inset-x-0 bottom-20 z-40 px-4 sm:bottom-4 lg:bottom-4">
        <div className="border-primary-200 bg-primary-50 mx-auto flex max-w-md items-center gap-3 rounded-[12px] border p-3 shadow-md">
          <div className="bg-primary-600 flex size-9 shrink-0 items-center justify-center rounded-full text-white">
            <Download className="size-4" />
          </div>
          <div className="flex-1 text-sm">
            <p className="text-primary-900 font-medium">Installer Coligo</p>
            <p className="text-primary-700 text-xs">
              {isIos
                ? "Ajoutez l'app à votre écran d'accueil."
                : "Plus rapide et notifications en temps réel."}
            </p>
          </div>
          <button
            type="button"
            onClick={handle}
            className="bg-primary-600 hover:bg-primary-700 inline-flex h-9 items-center rounded-[10px] px-3 text-sm font-medium text-white"
          >
            Installer
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Plus tard"
            className="text-primary-700 hover:bg-primary-100 flex size-8 items-center justify-center rounded-full"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {iosOpen && <IosInstallSheet onClose={() => setIosOpen(false)} />}
    </>
  );
}
