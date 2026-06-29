import { Bike } from "lucide-react";
import { DeliveryHubTabs } from "@/components/admin/delivery/delivery-hub-tabs";
import { getDriverRegistrations } from "@/lib/data/admin-drivers";

export const dynamic = "force-dynamic";

// Hub Livraison : regroupe Livreurs / Inscriptions / Finances livraison /
// Paramètres & zones en onglets. Scopé au route group (hub) : la fiche livreur
// [id] reste hors hub. Le badge « Inscriptions » = livreurs avec pièces à
// valider. Gate super-admin assuré par app/admin/layout.tsx.
export default async function DeliveryHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pendingCount = (await getDriverRegistrations()).length;
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6">
      <header className="mb-4 flex items-center gap-2">
        <Bike className="size-6" />
        <h1 className="text-2xl font-bold tracking-tight">Livraison</h1>
      </header>
      <div className="border-border mb-6 border-b pb-3">
        <DeliveryHubTabs pendingCount={pendingCount} />
      </div>
      {children}
    </div>
  );
}
