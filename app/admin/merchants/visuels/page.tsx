import { getImageBank, getMerchantVisuals } from "@/lib/data/admin-visuals";
import { getAllCategories } from "@/lib/data/categories";
import { MerchantVisualsView } from "@/components/admin/merchants/merchant-visuals-view";

export const dynamic = "force-dynamic";

// Onglet « Visuels » du hub Commerçants : banque d'images HD par catégorie
// (mig 0348) + liaison couverture/logo à un commerçant (manuelle ou auto).
// Objectif produit : une marketplace visuellement irréprochable — aucun
// commerce sans photo, aucun visuel flou ou cassé.
export default async function MerchantVisualsTab() {
  const [bank, merchants, categories] = await Promise.all([
    getImageBank(),
    getMerchantVisuals(),
    getAllCategories(),
  ]);

  return (
    <MerchantVisualsView
      bank={bank}
      merchants={merchants}
      categories={categories.map((c) => ({ code: c.code, label: c.label }))}
    />
  );
}
