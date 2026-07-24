import { CustomerShell } from "@/components/customer/customer-shell";
import { CartView } from "@/components/customer/cart-view";
import { getFeatureFlag } from "@/lib/data/feature-flags";

export const dynamic = "force-dynamic";

export default async function CartPage() {
  // Panier partagé (mig 0405) : le bouton « Inviter la famille » n'apparaît
  // que si la fonctionnalité est active (kill-switch super-admin).
  const sharedCart = await getFeatureFlag("shared_cart");

  return (
    <CustomerShell>
      <CartView sharedCartEnabled={sharedCart.status === "active"} />
    </CustomerShell>
  );
}
