import { getAllMerchantsForAdmin } from "@/lib/data/platform";
import { MerchantRegistrations } from "@/components/admin/merchants/merchant-registrations";

export const dynamic = "force-dynamic";

// Onglet « Inscriptions » du hub Commerçants : file de validation des nouvelles
// inscriptions (approuver / refuser / réexaminer). Cadre + titre + onglets
// fournis par layout.tsx.
export default async function MerchantRegistrationsTab() {
  const merchants = await getAllMerchantsForAdmin();
  return <MerchantRegistrations merchants={merchants} />;
}
