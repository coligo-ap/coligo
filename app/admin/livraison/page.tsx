import { DeliveryFinances } from "@/components/admin/delivery/delivery-finances";
import { requireAdminDomain } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

// Route transverse conservée. Même vue que l'onglet Finances du hub Livraison
// (/admin/drivers/finances) via le composant partagé DeliveryFinances.
export default async function AdminDeliveryFinancesPage() {
  await requireAdminDomain("livraison");
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6">
      <DeliveryFinances />
    </div>
  );
}
