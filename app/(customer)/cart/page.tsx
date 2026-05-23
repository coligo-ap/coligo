import { CustomerShell } from "@/components/customer/customer-shell";
import { CartView } from "@/components/customer/cart-view";

export const dynamic = "force-dynamic";

export default function CartPage() {
  return (
    <CustomerShell>
      <CartView />
    </CustomerShell>
  );
}
