"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Event Chrome/Android `beforeinstallprompt` (pas dans le DOM standard).
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "coligo-pwa-install-dismissed-at";
// 14 jours : on ne re-propose pas l'install si l'utilisateur a fermé la
// bannière, sauf après cette période.
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function detectIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPad récent se présente comme Mac → on regarde aussi le touch.
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || iPadOS;
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function isRecentlyDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Hook unique pour piloter l'installation PWA (Android/Chrome ET iOS).
 *
 * - `canInstall` : true si on peut lancer l'install dialog OU afficher les
 *   instructions iOS « Partager → Sur l'écran d'accueil ».
 * - `prompt()` : appelle `beforeinstallprompt.prompt()` (Android), sinon
 *   renvoie `"ios"` pour que l'UI affiche une fiche d'instructions.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setIsInstalled(detectStandalone());
    setIsIos(detectIos());
    setDismissed(isRecentlyDismissed());

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    const mql = window.matchMedia?.("(display-mode: standalone)");
    const onMql = (e: MediaQueryListEvent) => setIsInstalled(e.matches);
    mql?.addEventListener?.("change", onMql);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      mql?.removeEventListener?.("change", onMql);
    };
  }, []);

  const prompt = useCallback(async (): Promise<
    "accepted" | "dismissed" | "ios" | "unavailable"
  > => {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      setDeferred(null);
      return outcome;
    }
    if (isIos && !isInstalled) return "ios";
    return "unavailable";
  }, [deferred, isIos, isInstalled]);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignoré : Safari privé peut bloquer localStorage */
    }
    setDismissed(true);
  }, []);

  const canInstall = !isInstalled && (!!deferred || isIos);

  return {
    canInstall,
    isInstalled,
    isIos,
    dismissed,
    prompt,
    dismiss,
  };
}
