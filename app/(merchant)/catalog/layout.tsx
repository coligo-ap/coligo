import { MerchantShell } from "@/components/merchant/merchant-shell";

export default function CatalogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MerchantShell>{children}</MerchantShell>;
}
