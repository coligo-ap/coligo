import { Store } from "lucide-react";
import { MerchantHubTabs } from "@/components/admin/merchants/merchant-hub-tabs";

// Hub Commerçants : un seul domaine de nav regroupant Comptes / Commandes /
// Versements / Taux & paiement en onglets (sous-routes réelles). Le gate
// super-admin est assuré par app/admin/layout.tsx.
export default function MerchantHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <header className="mb-4 flex items-center gap-2">
        <Store className="size-6" />
        <h1 className="text-2xl font-bold tracking-tight">Commerçants</h1>
      </header>
      <div className="border-border mb-6 border-b pb-3">
        <MerchantHubTabs />
      </div>
      {children}
    </div>
  );
}
