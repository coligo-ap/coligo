import { Settings2 } from "lucide-react";
import { PlateformeHubTabs } from "@/components/admin/plateforme/plateforme-hub-tabs";
import { requireAdminDomain, isOwner } from "@/lib/auth/admin";

// Hub Plateforme : regroupe Contrôle services / Taux / Configuration / Zones +
// (owner) Admins en onglets (réglages transverses, source unique). Scopé au
// route group (plateforme). Gate super-admin via app/admin/layout.tsx ; ici on
// exige le domaine « plateforme » (owner passe toujours).
export default async function PlateformeHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminDomain("plateforme");
  const owner = await isOwner();
  return (
    <div>
      <div className="border-border border-b bg-white">
        <div className="mx-auto max-w-5xl px-4 pt-4 lg:px-6">
          <div className="mb-3 flex items-center gap-2">
            <Settings2 className="size-5" />
            <h1 className="text-lg font-bold tracking-tight">Plateforme</h1>
          </div>
          <div className="pb-2">
            <PlateformeHubTabs isOwner={owner} />
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
