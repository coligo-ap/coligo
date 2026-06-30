import {
  getAllMerchantsForAdmin,
  getPlatformSettings,
} from "@/lib/data/platform";
import { AdminMerchantsView } from "@/components/admin/admin-merchants-view";

export const dynamic = "force-dynamic";

// Onglet « Comptes » du hub Commerçants : comptes, inscriptions, validation,
// gel et surcharges de taux. (Cadre + titre + onglets fournis par layout.tsx.)
export default async function AdminMerchantsPage() {
  const [merchants, settings] = await Promise.all([
    getAllMerchantsForAdmin(),
    getPlatformSettings(),
  ]);

  return (
    <div>
      <p className="text-muted mb-5 text-sm">
        Soldes, surcharges de taux et gel. Laisser un taux vide = hérite du
        global.
      </p>
      <AdminMerchantsView initialMerchants={merchants} settings={settings} />
    </div>
  );
}
