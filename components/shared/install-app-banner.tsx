"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { X, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { isNative } from "@/lib/native/context";
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
    <div className="border-primary-100 bg-primary-50 mt-3 flex items-center gap-3 rounded-[16px] border px-3.5 py-2.5">
      <Link href="/app" className="flex min-w-0 flex-1 items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icon-192.png"
          alt=""
          className="size-10 shrink-0 rounded-[11px] shadow-sm"
        />
        <span className="min-w-0 flex-1">
          <b className="text-foreground block truncate text-[13.5px] font-extrabold">
            {t("title")}
          </b>
          <small className="text-muted block truncate text-[11.5px] font-semibold">
            {platform === "ios" ? "App Store" : "Google Play"} ·{" "}
            {t("availableOn")}
          </small>
        </span>
        <span className="bg-primary-600 grid size-8 shrink-0 place-items-center rounded-full text-white">
          <ArrowRight className="size-4 rtl:-scale-x-100" />
        </span>
      </Link>
      <button
        type="button"
        onClick={close}
        aria-label={t("continueWeb")}
        className="text-subtle hover:text-foreground -me-1 grid size-7 shrink-0 place-items-center rounded-full transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
