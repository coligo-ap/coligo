import { OfflineSyncIndicator } from "@/components/driver/offline-sync-indicator";
import { InstallBanner } from "@/components/pwa/install-banner";

/**
 * Layout du groupe (driver). Volontairement MINIMAL : chaque page gère son
 * propre chrome (DriverShell pour les pages app, AuthNavBar+AuthFooter pour
 * login/signup). Le layout ne pose que les composants globaux : install
 * banner PWA + processeur de file offline.
 */
export default function DriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <InstallBanner />
      <OfflineSyncIndicator />
    </>
  );
}
