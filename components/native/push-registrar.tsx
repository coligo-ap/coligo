"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BellRing, SquarePlus, X } from "lucide-react";
import {
  attachPushNavigation,
  isPushAvailable,
  registerPushToken,
  type PushRole,
} from "@/lib/native/push";
import { isWebPushConfigured } from "@/lib/native/push-web";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";

/** Re-proposer la bannière après ce délai si l'utilisateur l'a écartée. */
const DISMISS_KEY = "coligo_push_prompt_dismissed_at";
const DISMISS_TTL_MS = 7 * 24 * 3600 * 1000;

/** Ping télémétrie (IP/appareil, /api/telemetry/ping) : 1× / 6 h / appareil. */
const PING_KEY = "coligo_telemetry_ping_at";
const PING_TTL_MS = 6 * 3600 * 1000;

function detectPlatform(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X/i.test(ua)) return "macos";
  if (/Linux/i.test(ua)) return "linux";
  return "other";
}

/** Trace appareil/IP côté serveur — fire-and-forget, throttlé localStorage. */
function telemetryPing(role: PushRole) {
  try {
    const last = Number(localStorage.getItem(PING_KEY) ?? 0);
    if (last && last > Date.now() - PING_TTL_MS) return;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true ||
      isPushAvailable(); // APK Capacitor
    void fetch("/api/telemetry/ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, platform: detectPlatform(), standalone }),
    }).then((res) => {
      if (res.ok) localStorage.setItem(PING_KEY, String(Date.now()));
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Monté dans le shell de chaque rôle une fois l'utilisateur connu.
 * S'occupe en arrière-plan de :
 *  - demander la permission push et envoyer le token FCM au serveur ;
 *  - brancher le tap sur push → navigation Next.js vers la route portée
 *    par le payload (`data.route`).
 *
 * iOS (PWA installée) REFUSE `Notification.requestPermission()` hors geste
 * utilisateur → l'enregistrement auto au chargement échoue en silence. Dans ce
 * cas (permission encore « default » après la tentative auto), on affiche une
 * bannière « Activer les notifications » : le TAP fournit le geste requis et
 * relance l'enregistrement. Android accorde souvent dès la tentative auto →
 * pas de bannière.
 */
export function PushRegistrar({ role }: { role: PushRole }) {
  const router = useRouter();
  const t = useTranslations("push");
  const [showPrompt, setShowPrompt] = useState(false);
  /** `enable` = demander la permission (geste requis) ; `install` = Safari iOS
   *  en ONGLET : le push web n'existe que dans la PWA installée → on guide
   *  l'ajout à l'écran d'accueil au lieu de ne rien afficher. */
  const [mode, setMode] = useState<"enable" | "install">("enable");
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    // Trace appareil/IP/localisation (super-admin /admin/devices, anti-fraude).
    telemetryPing(role);

    // Enregistre le token push : natif (Capacitor Android) OU web (Firebase JS,
    // navigateur/PWA) — la bascule est gérée dans registerPushToken.
    void registerPushToken(role).then(() => {
      // Tentative auto terminée. Si la permission n'est toujours pas tranchée
      // (cas iOS : geste requis ; cas Android : prompt ignoré), on propose la
      // bannière — sauf si écartée récemment.
      if (isPushAvailable()) return; // natif : permission gérée par l'OS
      if (!isWebPushConfigured()) return;
      if (!("serviceWorker" in navigator)) return;
      const dismissedRecently = () => {
        try {
          const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
          return Boolean(at && at > new Date().getTime() - DISMISS_TTL_MS);
        } catch {
          return false; // localStorage indisponible : on affiche quand même
        }
      };
      // Sur iOS, `Notification` n'existe QUE dans la PWA installée — en onglet
      // Safari/Chrome le push web est IMPOSSIBLE. Plutôt que de se taire (le
      // client croit alors que « les notifications ne marchent pas »), on
      // explique le geste qui les rend possibles : Partager → Sur l'écran
      // d'accueil.
      if (typeof Notification === "undefined") {
        if (!/iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
        if (dismissedRecently()) return;
        setMode("install");
        setShowPrompt(true);
        return;
      }
      if (Notification.permission !== "default") return;
      if (dismissedRecently()) return;
      setMode("enable");
      setShowPrompt(true);
    });

    // La navigation au tap n'a de listener dédié qu'en natif ; sur web, le clic
    // est géré par le service worker (notificationclick) / la notif locale.
    if (!isPushAvailable()) return;
    let cleanup: (() => void) | null = null;
    void attachPushNavigation((path) => router.push(path)).then((c) => {
      cleanup = c;
    });
    return () => {
      cleanup?.();
    };
  }, [role, router]);

  // iOS ne COLD-START presque jamais une app : elle revient du background, donc
  // l'effet de montage (et son registerPushToken) ne rejoue pas — un token
  // (re)devenu enregistrable (permission accordée dans Réglages, rotation,
  // correctif serveur déployé entre-temps) n'était JAMAIS envoyé. À chaque
  // retour au premier plan : nouvelle tentative, idempotente (upsert
  // last_seen_at), throttlée 15 min. Sur web, on ne retente que si la
  // permission est DÉJÀ accordée (jamais de prompt hors geste).
  const lastResumeReg = useRef(0);
  useResumeResync(() => {
    const now = Date.now();
    if (now - lastResumeReg.current < 15 * 60_000) return;
    const canRetry =
      isPushAvailable() ||
      (typeof Notification !== "undefined" &&
        Notification.permission === "granted");
    if (!canRetry) return;
    lastResumeReg.current = now;
    void registerPushToken(role);
  });

  const enable = async () => {
    setEnabling(true);
    // Appel DANS le handler de tap → user activation valide pour iOS.
    const ok = await registerPushToken(role);
    setEnabling(false);
    // Permission tranchée (accordée ou refusée) → la bannière n'a plus d'objet.
    if (ok || Notification.permission !== "default") setShowPrompt(false);
  };

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(new Date().getTime()));
    } catch {
      /* ignore */
    }
    setShowPrompt(false);
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md">
      <div className="border-border flex items-start gap-3 rounded-[14px] border bg-white p-4 shadow-lg">
        <span className="bg-primary-50 text-primary-600 flex size-9 shrink-0 items-center justify-center rounded-full">
          {mode === "install" ? (
            <SquarePlus className="size-4.5" />
          ) : (
            <BellRing className="size-4.5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {mode === "install" ? t("installTitle") : t("enableTitle")}
          </p>
          <p className="text-muted mt-0.5 text-xs">
            {mode === "install" ? t("installBody") : t("enableBody")}
          </p>
          {mode === "enable" && (
            <button
              type="button"
              onClick={enable}
              disabled={enabling}
              className="bg-primary-600 hover:bg-primary-700 mt-2.5 inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-60"
            >
              <BellRing className="size-3.5" />
              {enabling ? "…" : t("enableCta")}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("dismiss")}
          className="text-muted hover:text-foreground -m-1 shrink-0 p-1 transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
