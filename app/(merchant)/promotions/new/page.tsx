import { getMerchantProductsLite } from "@/lib/data/promotions";
import { PromotionForm } from "@/components/merchant/promotions/promotion-form";

export const dynamic = "force-dynamic";

export default async function NewPromotionPage() {
  const products = await getMerchantProductsLite();
  return <PromotionForm products={products} />;
}
