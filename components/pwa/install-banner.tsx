"use client";

import { Download, X } from "lucide-react";
import { useInstallPrompt } from "@/lib/pwa/use-install-prompt";
import { useState } from "react";

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

      {iosOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center"
          onClick={() => setIosOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="border-border w-full max-w-sm rounded-t-[16px] border bg-white p-5 shadow-xl sm:rounded-[16px]"
          >
            <h2 className="mb-2 text-base font-semibold">
              Installer sur l&apos;écran d&apos;accueil
            </h2>
            <p className="text-muted text-sm">
              Ouvrez le menu <span className="font-medium">Partager</span> de
              Safari, puis choisissez{" "}
              <span className="font-medium">
                « Sur l&apos;écran d&apos;accueil »
              </span>
              .
            </p>
            <button
              type="button"
              onClick={() => setIosOpen(false)}
              className="bg-primary-600 hover:bg-primary-700 mt-4 inline-flex h-10 w-full items-center justify-center rounded-[10px] px-5 text-sm font-medium text-white"
            >
              Compris
            </button>
          </div>
        </div>
      )}
    </>
  );
}
