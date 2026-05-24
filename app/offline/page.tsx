import Link from "next/link";
import { WifiOff, RefreshCw } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { OfflineOrdersFallback } from "@/components/merchant/offline-orders-fallback";

export const metadata = {
  title: "Hors ligne — Coligo",
  description: "Connexion indisponible.",
};

export default function OfflinePage() {
  return (
    <main className="bg-surface-2 flex min-h-screen flex-col items-center px-6 py-10">
      <div className="border-border w-full max-w-sm rounded-[14px] border bg-white p-6 text-center shadow-sm">
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

        <Link
          href="/dashboard"
          className="bg-primary-600 hover:bg-primary-700 mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-[10px] px-5 text-sm font-medium text-white transition-colors"
        >
          <RefreshCw className="size-4" />
          Réessayer
        </Link>
      </div>

      {/* Affichage dégradé : dernières commandes connues du commerçant
          (lecture seule depuis IndexedDB). Vide si aucun cache local. */}
      <OfflineOrdersFallback />
    </main>
  );
}
