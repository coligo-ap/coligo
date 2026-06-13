"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MonitorDown } from "lucide-react";
import { isNative } from "@/lib/native/context";
import { isAndroid, isIos, isStandalone } from "@/lib/pwa/platform";
import { cn } from "@/lib/utils";
import { AndroidIcon, AndroidInstallSheet } from "./android-install-sheet";
import { AppleIcon, IosInstallSheet } from "./ios-install-sheet";

/**
 * Bouton « Installer l'application » (PWA) — un par espace (client, livreur,
 * chauffeur, commerçant), chacun installant SA déclinaison (manifest/icône/nom
 * du segment, cf. lib/config/pwa.ts).
 *
 * - Chrome/Edge/Brave Android + desktop : on capture `beforeinstallprompt` et
 *   le tap ouvre DIRECTEMENT le prompt d'installation natif (zéro étape
 *   manuelle, pas de « menu ⋮ »).
 * - iPhone/iPad (aucun prompt programmable côté Apple) : le tap ouvre la fiche
 *   guidée Safari « Partager → Sur l'écran d'accueil ».
 * - Android sans prompt natif (Firefox, navigateurs in-app) : fiche guidée
 *   « menu ⋮ → Installer ».
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
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
  });
}

type Platform = "ios" | "android" | "other";

export function InstallAppButton({
  className,
  label,
  subtitle,
}: {
  className?: string;
  /** Libellé spécifique (ex. « Installer l'application Livreur ») — défaut i18n. */
  label?: string;
  subtitle?: string;
}) {
  const t = useTranslations("install");
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<Platform>("other");
  const [guide, setGuide] = useState<"ios" | "android" | null>(null);

  useEffect(() => {
    // Visible seulement sur web NON installé (ni APK, ni PWA déjà posée).
    setVisible(!isNative() && !isStandalone());
    setPlatform(isIos() ? "ios" : isAndroid() ? "android" : "other");
  }, []);

  if (!visible) return null;

  const onInstall = async () => {
    // Android/desktop Chrome : prompt natif direct, aucune étape manuelle.
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
    // Pas de prompt programmable → fiche guidée selon la plateforme.
    setGuide(platform === "ios" ? "ios" : "android");
  };

  const Icon =
    platform === "ios"
      ? AppleIcon
      : platform === "android"
        ? AndroidIcon
        : null;
  const defaultLabel =
    platform === "ios"
      ? t("ctaIos")
      : platform === "android"
        ? t("ctaAndroid")
        : t("cta");

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
          {Icon ? (
            <Icon className="size-5" />
          ) : (
            <MonitorDown className="size-5" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">
            {label ?? defaultLabel}
          </span>
          <span className="text-muted block text-xs">
            {subtitle ?? t("subtitle")}
          </span>
        </span>
      </button>

      {guide === "ios" && <IosInstallSheet onClose={() => setGuide(null)} />}
      {guide === "android" && (
        <AndroidInstallSheet onClose={() => setGuide(null)} />
      )}
    </>
  );
}
