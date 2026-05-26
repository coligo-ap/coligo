import { OfflineSyncIndicator } from "@/components/driver/offline-sync-indicator";
import { InstallBanner } from "@/components/pwa/install-banner";

/**
 * Layout PWA livreur — pas de chrome partagé avec commerçant/client.
 * UI mobile-first légère, fond clair, header compact rendu par les pages.
 *
 * `InstallBanner` propose à un livreur de poser la PWA sur son écran
 * d'accueil (auto-caché si déjà installée ou refusée). Il réutilise le
 * manifest existant, donc rien à configurer côté Android/iOS.
 */
export default function DriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface-2 min-h-screen">
      <div className="mx-auto max-w-md p-4">{children}</div>
      <InstallBanner />
      <OfflineSyncIndicator />
    </div>
  );
}
