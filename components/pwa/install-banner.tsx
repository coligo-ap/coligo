"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MonitorDown, X } from "lucide-react";
import { useInstallPrompt } from "@/lib/pwa/use-install-prompt";
import { isAndroid } from "@/lib/pwa/platform";
import { cn } from "@/lib/utils";
import { AndroidIcon, AndroidInstallSheet } from "./android-install-sheet";
import { AppleIcon, IosInstallSheet } from "./ios-install-sheet";

/**
 * Petit popup bas, non intrusif, qui invite à installer l'app et SUIT
 * l'utilisateur sur les portails de connexion/inscription (un par espace)
 * jusqu'à ce que l'app soit installée. Fermable (mémorisé 14 j).
 *
 * - Android (Chrome/Edge/Brave) : « Installer » ouvre DIRECTEMENT le prompt natif.
 * - iPhone : ouvre la fiche guidée Safari (Apple n'expose aucun prompt).
 * - Android sans prompt : fiche guidée « menu ⋮ ».
 * Auto-caché si déjà installée, refusée récemment, ou en APK natif.
 *
 * `label`/`text` permettent d'adapter le message à l'espace (commerçant,
 * livreur…) ; sinon valeurs i18n par défaut.
 */
export function InstallBanner({
  label,
  text,
  className,
}: {
  label?: string;
  text?: string;
  className?: string;
}) {
  const t = useTranslations("install");
  const { canInstall, isIos, dismissed, prompt, dismiss } = useInstallPrompt();
  const [iosOpen, setIosOpen] = useState(false);
  const [androidOpen, setAndroidOpen] = useState(false);
  // Petite animation d'entrée (slide-up + fondu) une fois monté.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (canInstall && !dismissed) {
      const id = window.setTimeout(() => setShown(true), 30);
      return () => window.clearTimeout(id);
    }
    setShown(false);
  }, [canInstall, dismissed]);

  if (!canInstall || dismissed) return null;

  async function handle() {
    const res = await prompt();
    if (res === "ios") setIosOpen(true);
    else if (res === "unavailable" && isAndroid()) setAndroidOpen(true);
  }

  const Icon = isIos ? AppleIcon : isAndroid() ? AndroidIcon : MonitorDown;

  return (
    <>
      <div
        className={cn(
          "fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 px-3 sm:bottom-4",
          className
        )}
      >
        <div
          className={cn(
            "border-border mx-auto flex max-w-sm items-center gap-2.5 rounded-lg border bg-white/95 p-2.5 backdrop-blur transition-all duration-300 ease-out",
            shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
          )}
        >
          <span className="from-primary-600 to-primary-700 flex size-10 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-white">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-body-sm leading-tight font-semibold">
              {label ?? t("bannerTitle")}
            </p>
            <p className="text-muted text-caption truncate leading-tight">
              {text ?? (isIos ? t("bannerTextIos") : t("bannerText"))}
            </p>
          </div>
          <button
            type="button"
            onClick={handle}
            className="bg-primary-600 hover:bg-primary-700 rounded-control inline-flex h-8 shrink-0 items-center px-3 text-xs font-semibold text-white"
          >
            {t("action")}
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("close")}
            className="text-muted hover:bg-surface-2 -me-0.5 flex size-7 shrink-0 items-center justify-center rounded-full"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {iosOpen && <IosInstallSheet onClose={() => setIosOpen(false)} />}
      {androidOpen && (
        <AndroidInstallSheet onClose={() => setAndroidOpen(false)} />
      )}
    </>
  );
}
