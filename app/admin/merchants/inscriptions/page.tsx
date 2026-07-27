import {
  getAllMerchantsForAdmin,
  getMerchantCategoryOptions,
  getSignupDraftsForAdmin,
} from "@/lib/data/platform";
import { MerchantRegistrations } from "@/components/admin/merchants/merchant-registrations";

export const dynamic = "force-dynamic";

// Onglet « Inscriptions » du hub Commerçants : file de validation des nouvelles
// inscriptions (approuver / refuser / réexaminer) + inscriptions COMMENCÉES
// mais non finalisées (brouillons du wizard, mig 0414) à recontacter.
// Cadre + titre + onglets fournis par layout.tsx.
export default async function MerchantRegistrationsTab() {
  const [merchants, drafts, catOptions] = await Promise.all([
    getAllMerchantsForAdmin(),
    getSignupDraftsForAdmin(),
    getMerchantCategoryOptions(),
  ]);
  const catLabels = Object.fromEntries(
    catOptions.map((c) => [c.code, c.label])
  );
  return (
    <MerchantRegistrations
      merchants={merchants}
      drafts={drafts}
      catLabels={catLabels}
    />
  );
}
