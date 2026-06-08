import { Sora, Plus_Jakarta_Sans } from "next/font/google";
import "./maquette.css";
import { OfflineSyncIndicator } from "@/components/driver/offline-sync-indicator";
import { DriverDispatchMount } from "@/components/driver/driver-dispatch-mount";
import { DriverSplash } from "@/components/driver/driver-splash";
import { ActiveCourseBanner } from "@/components/driver/active-course-banner";
import { DriverThemeRoot } from "@/components/driver/driver-theme-root";
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
// Polices EXACTES des maquettes : Sora (titres/chiffres) + Plus Jakarta Sans
// (corps). Exposées en variables CSS consommées par app/(driver)/maquette.css.
const fontSora = Sora({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sora",
  weight: ["500", "600", "700", "800"],
});
const fontJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jakarta",
  weight: ["400", "500", "600", "700"],
});

export default function DriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DriverThemeRoot fontVars={`${fontSora.variable} ${fontJakarta.variable}`}>
      {children}
      {/* Écran de lancement (une fois par session). */}
      <DriverSplash />
      {/* Réception Express globale (pilotée par l'intention « en ligne »). */}
      <DriverDispatchMount />
      {/* Bandeau « Course en cours » réductible, épinglé sur tous les onglets. */}
      <ActiveCourseBanner />
      <InstallBanner />
      <OfflineSyncIndicator />
    </DriverThemeRoot>
  );
}
