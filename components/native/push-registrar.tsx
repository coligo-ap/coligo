"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BellRing, X } from "lucide-react";
import {
  attachPushNavigation,
  isPushAvailable,
  registerPushToken,
  type PushRole,
} from "@/lib/native/push";
import { isWebPushConfigured } from "@/lib/native/push-web";

/** Re-proposer la bannière après ce délai si l'utilisateur l'a écartée. */
const DISMISS_KEY = "coligo_push_prompt_dismissed_at";
const DISMISS_TTL_MS = 7 * 24 * 3600 * 1000;

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
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    // Enregistre le token push : natif (Capacitor Android) OU web (Firebase JS,
    // navigateur/PWA) — la bascule est gérée dans registerPushToken.
    void registerPushToken(role).then(() => {
      // Tentative auto terminée. Si la permission n'est toujours pas tranchée
      // (cas iOS : geste requis ; cas Android : prompt ignoré), on propose la
      // bannière — sauf si écartée récemment.
      if (isPushAvailable()) return; // natif : permission gérée par l'OS
      if (!isWebPushConfigured()) return;
      if (!("serviceWorker" in navigator)) return;
      // Sur iOS, `Notification` n'existe QUE dans la PWA installée — en onglet
      // Safari/Chrome il est absent et le push web est impossible : pas de
      // bannière mensongère.
      if (typeof Notification === "undefined") return;
      if (Notification.permission !== "default") return;
      try {
        const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
        if (dismissedAt && dismissedAt > new Date().getTime() - DISMISS_TTL_MS)
          return;
      } catch {
        /* localStorage indisponible : on affiche quand même */
      }
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
          <BellRing className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("enableTitle")}</p>
          <p className="text-muted mt-0.5 text-xs">{t("enableBody")}</p>
          <button
            type="button"
            onClick={enable}
            disabled={enabling}
            className="bg-primary-600 hover:bg-primary-700 mt-2.5 inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-60"
          >
            <BellRing className="size-3.5" />
            {enabling ? "…" : t("enableCta")}
          </button>
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
