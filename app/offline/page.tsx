import { WifiOff } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { OfflineRetry } from "@/components/shared/offline-retry";
import { OfflineOrdersFallback } from "@/components/merchant/offline-orders-fallback";

export const metadata = {
  title: "Hors ligne — Coligo",
  description: "Connexion indisponible.",
};

export default function OfflinePage() {
  return (
    <main className="bg-surface-2 flex min-h-screen flex-col items-center px-6 py-10">
      <div className="border-border rounded-card-lg w-full max-w-sm border bg-white p-6 text-center">
        <div className="mb-6 flex justify-center">
          <Logo variant="amber" size="lg" />
        </div>

        <div className="bg-primary-50 text-primary-700 mx-auto mb-4 flex size-12 items-center justify-center rounded-full">
          <WifiOff className="size-6" />
        </div>

        <h1 className="text-foreground text-xl font-bold">Pas de connexion</h1>
        <p className="text-muted mt-2 text-sm">
          Vérifiez votre Wi-Fi ou vos données mobiles, puis réessayez.
        </p>

        <OfflineRetry />
      </div>

      {/* Affichage dégradé : dernières commandes connues du commerçant
          (lecture seule depuis IndexedDB). Vide si aucun cache local. */}
      <OfflineOrdersFallback />
    </main>
  );
}
