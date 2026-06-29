import { Megaphone } from "lucide-react";
import { MarketingHubTabs } from "@/components/admin/marketing/marketing-hub-tabs";

// Hub Marketing & Communication : regroupe Bannières / Notifications en onglets.
// Bande fine : chaque page garde son conteneur/titre (vues partagées avec les
// routes transverses). Gate super-admin via app/admin/layout.tsx.
export default function MarketingHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="border-border border-b bg-white">
        <div className="mx-auto max-w-3xl px-4 pt-4 lg:px-6">
          <div className="mb-3 flex items-center gap-2">
            <Megaphone className="size-5" />
            <h1 className="text-lg font-bold tracking-tight">
              Marketing &amp; Communication
            </h1>
          </div>
          <div className="pb-2">
            <MarketingHubTabs />
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
