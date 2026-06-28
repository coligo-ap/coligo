import { Bike } from "lucide-react";
import { DeliveryHubTabs } from "@/components/admin/delivery/delivery-hub-tabs";

// Hub Livraison : regroupe Livreurs / Finances livraison / Paramètres & zones
// en onglets (sous-routes réelles). Scopé au route group (hub) : la fiche
// livreur [id] reste hors hub. Gate super-admin assuré par app/admin/layout.tsx.
export default function DeliveryHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6">
      <header className="mb-4 flex items-center gap-2">
        <Bike className="size-6" />
        <h1 className="text-2xl font-bold tracking-tight">Livraison</h1>
      </header>
      <div className="border-border mb-6 border-b pb-3">
        <DeliveryHubTabs />
      </div>
      {children}
    </div>
  );
}
