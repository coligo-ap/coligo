import { Car } from "lucide-react";
import { DriveHubTabs } from "@/components/admin/drive/drive-hub-tabs";

// Hub Coligo Drive : regroupe Chauffeurs / Configuration Drive / Paramètres &
// zones en onglets (sous-routes réelles). Scopé au route group (hub) : la fiche
// chauffeur [id] reste hors hub. Gate super-admin via app/admin/layout.tsx.
export default function DriveHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6">
      <header className="mb-4 flex items-center gap-2">
        <Car className="size-6" />
        <h1 className="text-2xl font-bold tracking-tight">Coligo Drive</h1>
      </header>
      <div className="border-border mb-6 border-b pb-3">
        <DriveHubTabs />
      </div>
      {children}
    </div>
  );
}
