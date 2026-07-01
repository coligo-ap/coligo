import { ShieldCheck } from "lucide-react";
import { ConfianceHubTabs } from "@/components/admin/confiance/confiance-hub-tabs";
import { requireAdminDomain } from "@/lib/auth/admin";

// Hub Confiance & Sécurité : regroupe Signalements / Appareils / Sécurité en
// onglets. Scopé au route group (confiance) ; URLs des pages inchangées. Bande
// fine : chaque page garde son conteneur. Gate super-admin via app/admin/layout.tsx.
export default async function ConfianceHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminDomain("confiance");
  return (
    <div>
      <div className="border-border border-b bg-white">
        <div className="mx-auto max-w-5xl px-4 pt-4 lg:px-6">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="size-5" />
            <h1 className="text-lg font-bold tracking-tight">
              Confiance &amp; Sécurité
            </h1>
          </div>
          <div className="pb-2">
            <ConfianceHubTabs />
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
