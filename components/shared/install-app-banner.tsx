"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { isNative } from "@/lib/native/context";
import { StoreBadges } from "@/components/shared/store-badges";
import {
  detectPlatformClient,
  type DevicePlatform,
} from "@/lib/config/app-stores";

const DISMISS_KEY = "coligo:install-banner:dismissed";

/**
 * Bandeau « installer l'application » — WEB MOBILE uniquement.
 *
 * Trois garde-fous, dans cet ordre :
 *   1. jamais DANS l'application native (on ne propose pas d'installer ce qui
 *      tourne déjà) — c'est l'erreur la plus visible qu'on puisse faire ;
 *   2. jamais sur ordinateur (le pied de page porte déjà les deux badges) ;
 *   3. jamais après un refus : le choix est mémorisé sur l'appareil.
 *
 * Il ne s'affiche qu'APRÈS montage : le rendu serveur ne connaît pas l'appareil,
 * et un bandeau qui apparaît puis disparaît serait pire que pas de bandeau.
 */
export function InstallAppBanner() {
  const t = useTranslations("download");
  const [platform, setPlatform] = useState<DevicePlatform | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (isNative()) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* stockage indisponible (navigation privée) : on affiche */
    }
    if (dismissed) return;
    const p = detectPlatformClient();
    if (p === "desktop") return;
    setPlatform(p);
    setHidden(false);
  }, []);

  if (hidden || !platform) return null;

  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* sans gravité : le bandeau reviendra à la prochaine visite */
    }
  };

  return (
    <div className="border-primary-100 bg-primary-50 mt-3 flex items-center gap-3 rounded-lg border px-3.5 py-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-192.png" alt="" className="size-11 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <b className="text-foreground text-body block truncate font-extrabold">
          {t("title")}
        </b>
        <small className="text-muted text-caption-lg block truncate font-semibold">
          {t("subtitleShort")}
        </small>
        {/* Le BADGE OFFICIEL de la boutique de l'appareil, cliquable : c'est
            lui le bouton d'action (App Store sur iPhone, Google Play sur
            Android), comme le font les grandes applications. */}
        <StoreBadges only="detected" size="sm" className="mt-2" />
      </div>
      <button
        type="button"
        onClick={close}
        aria-label={t("continueWeb")}
        className="text-subtle hover:text-foreground -me-1 grid size-7 shrink-0 place-items-center self-start rounded-full transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
