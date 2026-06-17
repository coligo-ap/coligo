import {
  getAllMerchantsForAdmin,
  getPlatformSettings,
} from "@/lib/data/platform";
import { AdminMerchantsView } from "@/components/admin/admin-merchants-view";
import { ModulePaymentAccount } from "@/components/admin/module-payment-account";

export const dynamic = "force-dynamic";

export default async function AdminMerchantsPage() {
  const [merchants, settings] = await Promise.all([
    getAllMerchantsForAdmin(),
    getPlatformSettings(),
  ]);

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Commerçants</h1>
        <p className="text-muted mt-1 text-sm">
          Soldes, surcharges de taux et gel. Laisser un taux vide = hérite du
          global.
        </p>
      </header>
      <AdminMerchantsView merchants={merchants} settings={settings} />

      <div className="mt-6">
        <ModulePaymentAccount scope="merchant" />
      </div>
    </div>
  );
}
