import { DeliveryFinances } from "@/components/admin/delivery/delivery-finances";

export const dynamic = "force-dynamic";

// Route transverse conservée. Même vue que l'onglet Finances du hub Livraison
// (/admin/drivers/finances) via le composant partagé DeliveryFinances.
export default function AdminDeliveryFinancesPage() {
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6">
      <DeliveryFinances />
    </div>
  );
}
