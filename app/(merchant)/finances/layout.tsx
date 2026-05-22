import { MerchantShell } from "@/components/merchant/merchant-shell";

export default function FinancesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MerchantShell>{children}</MerchantShell>;
}
