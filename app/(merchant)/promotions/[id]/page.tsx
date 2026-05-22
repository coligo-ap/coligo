import { notFound } from "next/navigation";
import { getMerchantProductsLite, getPromotion } from "@/lib/data/promotions";
import { PromotionForm } from "@/components/merchant/promotions/promotion-form";

export const dynamic = "force-dynamic";

export default async function EditPromotionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [promotion, products] = await Promise.all([
    getPromotion(id),
    getMerchantProductsLite(),
  ]);

  if (!promotion) notFound();

  return <PromotionForm products={products} promotion={promotion} />;
}
