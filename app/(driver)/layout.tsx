import { Inter } from "next/font/google";
import { OfflineSyncIndicator } from "@/components/driver/offline-sync-indicator";
import { DriverDispatchMount } from "@/components/driver/driver-dispatch-mount";
import { DriverSplash } from "@/components/driver/driver-splash";
import { InstallBanner } from "@/components/pwa/install-banner";

/**
 * Layout du groupe (driver). Volontairement MINIMAL : chaque page gère son
 * propre chrome (DriverShell pour les pages app, AuthNavBar+AuthFooter pour
 * login/signup). Le layout ne pose que les composants globaux : install
 * banner PWA + processeur de file offline.
 *
 * Refonte « style Uber » : tout l'espace livreur est scopé via
 * `data-space="driver"` (cf. globals.css) → police Inter + palette dédiée
 * (fond gris, cards blanches, boutons noirs, violet rare). Le `@theme` global
 * de l'app (commerçant/client/admin) n'est PAS touché.
 */
const fontDriver = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  weight: ["400", "500", "600", "700", "800", "900"],
});

export default function DriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div data-space="driver" className={fontDriver.variable}>
      {children}
      {/* Écran de lancement (une fois par session). */}
      <DriverSplash />
      {/* Réception Express globale (pilotée par l'intention « en ligne »). */}
      <DriverDispatchMount />
      <InstallBanner />
      <OfflineSyncIndicator />
    </div>
  );
}
