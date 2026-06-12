"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MonitorDown, Share, SquarePlus, X } from "lucide-react";
import { isNative } from "@/lib/native/context";
import { cn } from "@/lib/utils";

/**
 * Bouton « Installer l'application » (PWA) — un par espace (client, livreur,
 * chauffeur, commerçant), chacun installant SA déclinaison (manifest/icône/nom
 * du segment, cf. lib/config/pwa.ts).
 *
 * - Chrome Android/desktop : on capture `beforeinstallprompt` et le tap ouvre
 *   le prompt d'installation natif.
 * - iOS (aucun prompt programmable) : le tap ouvre un mini-guide
 *   « Partager → Sur l'écran d'accueil ».
 * - Déjà installé (standalone) ou APK Capacitor : rien ne s'affiche.
 *
 * L'événement `beforeinstallprompt` peut partir AVANT le montage React → on le
 * capture au chargement du module et on garde la dernière valeur.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
  });
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS expose `navigator.standalone` (hors spec).
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function InstallAppButton({ className }: { className?: string }) {
  const t = useTranslations("install");
  const [visible, setVisible] = useState(false);
  const [guide, setGuide] = useState<"ios" | "android" | null>(null);

  useEffect(() => {
    // Visible seulement sur web NON installé (ni APK, ni PWA déjà posée).
    setVisible(!isNative() && !isStandalone());
  }, []);

  if (!visible) return null;

  const onInstall = async () => {
    if (deferredPrompt) {
      const p = deferredPrompt;
      await p.prompt();
      const { outcome } = await p.userChoice;
      if (outcome === "accepted") {
        deferredPrompt = null;
        setVisible(false);
      }
      return;
    }
    // Pas de prompt programmable → guide manuel selon la plateforme.
    setGuide(isIos() ? "ios" : "android");
  };

  return (
    <>
      <button
        type="button"
        onClick={onInstall}
        className={cn(
          "border-border hover:bg-surface-2 flex w-full items-center gap-3 rounded-[14px] border bg-white p-4 text-start transition-colors",
          className
        )}
      >
        <span className="bg-primary-50 text-primary-600 flex size-10 shrink-0 items-center justify-center rounded-full">
          <MonitorDown className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{t("cta")}</span>
          <span className="text-muted block text-xs">{t("subtitle")}</span>
        </span>
      </button>

      {guide && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onClick={() => setGuide(null)}
        >
          <div
            className="w-full max-w-sm rounded-[18px] bg-white p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold">
                {t(guide === "ios" ? "iosTitle" : "androidTitle")}
              </h2>
              <button
                type="button"
                onClick={() => setGuide(null)}
                aria-label={t("close")}
                className="text-muted hover:text-foreground -m-1 p-1"
              >
                <X className="size-5" />
              </button>
            </div>
            {guide === "ios" ? (
              <ol className="space-y-3 text-sm">
                <li className="flex items-center gap-3">
                  <span className="bg-primary-50 text-primary-600 flex size-8 shrink-0 items-center justify-center rounded-full">
                    <Share className="size-4" />
                  </span>
                  <span>
                    <span className="text-muted me-1.5 font-semibold">1.</span>
                    {t("iosStep1")}
                  </span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="bg-primary-50 text-primary-600 flex size-8 shrink-0 items-center justify-center rounded-full">
                    <SquarePlus className="size-4" />
                  </span>
                  <span>
                    <span className="text-muted me-1.5 font-semibold">2.</span>
                    {t("iosStep2")}
                  </span>
                </li>
              </ol>
            ) : (
              <p className="text-sm">{t("androidHint")}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
