import { LayoutDashboard } from "lucide-react";
import { getLateOrdersCountForAdmin } from "@/lib/data/platform";
import { PilotageHubTabs } from "@/components/admin/pilotage/pilotage-hub-tabs";
import { requireAdminDomain } from "@/lib/auth/admin";

// Hub Pilotage (cockpit) : regroupe Vue d'ensemble / Commandes / Alertes en
// onglets. Scopé au route group (pilotage) : seules ces 3 pages reçoivent les
// onglets, le reste de /admin n'est pas affecté. Bande fine : chaque page garde
// son conteneur. Gate super-admin assuré par app/admin/layout.tsx.
export default async function PilotageHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminDomain("pilotage");
  const lateCount = await getLateOrdersCountForAdmin();
  return (
    <div>
      <div className="border-border border-b bg-white">
        <div className="mx-auto max-w-[1100px] px-4 pt-4 lg:px-6">
          <div className="mb-3 flex items-center gap-2">
            <LayoutDashboard className="size-5" />
            <h1 className="text-lg font-bold tracking-tight">Pilotage</h1>
          </div>
          <div className="pb-2">
            <PilotageHubTabs lateCount={lateCount} />
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
