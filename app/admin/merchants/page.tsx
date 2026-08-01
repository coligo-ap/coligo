import {
  getMerchantsForAdmin,
  getMerchantCategoryOptions,
  getPlatformSettings,
} from "@/lib/data/platform";
import { AdminMerchantsView } from "@/components/admin/admin-merchants-view";

export const dynamic = "force-dynamic";

// Onglet « Comptes » du hub Commerçants : comptes, inscriptions, validation,
// gel, surcharges de taux et raccordement aux catégories. (Cadre + titre +
// onglets fournis par layout.tsx.)
export default async function AdminMerchantsPage() {
  const [merchants, settings, categoryOptions] = await Promise.all([
    // 3 commerçants seulement : la recherche et « Voir plus » chargent la
    // suite à la demande — inutile de solliciter la base pour tout le reste.
    getMerchantsForAdmin({ limit: 3 }),
    getPlatformSettings(),
    getMerchantCategoryOptions(),
  ]);

  return (
    <div>
      <p className="text-muted mb-5 text-sm">
        Soldes, surcharges de taux et gel. Laisser un taux vide = hérite du
        global.
      </p>
      <AdminMerchantsView
        initialMerchants={merchants.rows}
        initialTotal={merchants.total}
        settings={settings}
        categoryOptions={categoryOptions}
      />
    </div>
  );
}
