import { MerchantShell } from "@/components/merchant/merchant-shell";

export default function PromotionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MerchantShell>{children}</MerchantShell>;
}
