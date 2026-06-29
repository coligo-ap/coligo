import { Wallet } from "lucide-react";
import { FinancesHubTabs } from "@/components/admin/coligo-pay/finances-hub-tabs";

// Hub Coligo Pay & Finances : regroupe Surveillance / Agents / Recharges /
// Versements en onglets (sous-routes réelles). Bande d'onglets fine : chaque
// page garde son propre conteneur/titre (composants autonomes lourds réutilisés
// tels quels). La fiche agent [id] est hors hub (autre arbre de routes).
// Gate super-admin assuré par app/admin/layout.tsx.
export default function FinancesHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="border-border border-b bg-white">
        <div className="mx-auto max-w-[1100px] px-4 pt-4 lg:px-6">
          <div className="mb-3 flex items-center gap-2">
            <Wallet className="size-5" />
            <h1 className="text-lg font-bold tracking-tight">
              Coligo Pay &amp; Finances
            </h1>
          </div>
          <div className="pb-2">
            <FinancesHubTabs />
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
