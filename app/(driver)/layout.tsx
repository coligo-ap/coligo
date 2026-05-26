import { OfflineSyncIndicator } from "@/components/driver/offline-sync-indicator";

/**
 * Layout PWA livreur — pas de chrome partagé avec commerçant/client.
 * UI mobile-first légère, fond clair, header compact rendu par les pages.
 */
export default function DriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface-2 min-h-screen">
      <div className="mx-auto max-w-md p-4">{children}</div>
      <OfflineSyncIndicator />
    </div>
  );
}
