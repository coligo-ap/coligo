"use client";

import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { InstallBanner } from "@/components/pwa/install-banner";

/**
 * Bannière d'installation PWA de l'espace livreur, consciente de la route :
 * sur l'ACCUEIL, le bas de l'écran est occupé par la barre « En ligne /
 * Hors ligne » (ou le bandeau « Course en cours ») dockée à ~78 px — la
 * bannière se place AU-DESSUS pour ne jamais être masquée. Sur les autres
 * pages, elle reste juste au-dessus de la nav basse.
 */
export function DriverInstallBanner() {
  const isHome = usePathname() === "/driver";
  const isAr = useLocale() === "ar";
  return (
    <InstallBanner
      label={isAr ? "ثبّت تطبيق الموصّل" : "Installer l'application Livreur"}
      className={
        isHome
          ? "bottom-[calc(env(safe-area-inset-bottom)+10.75rem)]"
          : "bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] sm:bottom-4"
      }
    />
  );
}
