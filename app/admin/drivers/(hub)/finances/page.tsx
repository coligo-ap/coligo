import { DeliveryFinances } from "@/components/admin/delivery/delivery-finances";

export const dynamic = "force-dynamic";

// Onglet « Finances livraison » du hub : ledger livreurs + compteurs + audit
// (composant partagé avec la route transverse /admin/livraison).
export default function DeliveryFinancesTab() {
  return <DeliveryFinances />;
}
