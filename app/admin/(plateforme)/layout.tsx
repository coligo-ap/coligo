import { Settings2 } from "lucide-react";
import { PlateformeHubTabs } from "@/components/admin/plateforme/plateforme-hub-tabs";

// Hub Plateforme : regroupe Contrôle services / Taux / Configuration / Zones en
// onglets (réglages transverses, source unique). Scopé au route group
// (plateforme) ; URLs des pages inchangées. Bande fine : chaque page garde son
// conteneur. Gate super-admin via app/admin/layout.tsx.
export default function PlateformeHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="border-border border-b bg-white">
        <div className="mx-auto max-w-5xl px-4 pt-4 lg:px-6">
          <div className="mb-3 flex items-center gap-2">
            <Settings2 className="size-5" />
            <h1 className="text-lg font-bold tracking-tight">Plateforme</h1>
          </div>
          <div className="pb-2">
            <PlateformeHubTabs />
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
