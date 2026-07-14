import { Store } from "lucide-react";
import { getPendingMerchantsCountForAdmin } from "@/lib/data/platform";
import { requireAdminDomain } from "@/lib/auth/admin";
import { AdminHubTabs } from "@/components/admin/admin-hub-tabs";

export const dynamic = "force-dynamic";

// Hub Commerçants : un seul domaine de nav regroupant Comptes / Inscriptions /
// Commandes / Versements / Taux & paiement en onglets (sous-routes réelles). Le
// gate super-admin est assuré par app/admin/layout.tsx. Le badge « Inscriptions »
// reflète les demandes d'inscription en attente (mig 0273).
export default async function MerchantHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminDomain("commercants");
  const pendingCount = await getPendingMerchantsCountForAdmin();
  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <header className="mb-4 flex items-center gap-2">
        <Store className="size-6" />
        <h1 className="text-2xl font-bold tracking-tight">Commerçants</h1>
      </header>
      <div className="border-border mb-6 border-b pb-3">
        <AdminHubTabs domain="commercants" pendingCount={pendingCount} />
      </div>
      {children}
    </div>
  );
}
