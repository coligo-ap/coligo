import { getMerchantPromotions } from "@/lib/data/promotions";
import { effectivePromotionStatus } from "@/lib/promotions/engine";
import { PromotionsView } from "@/components/merchant/promotions/promotions-view";
import type { PromotionStatus, PromotionWithProducts } from "@/lib/types";

export const dynamic = "force-dynamic";

export type PromotionListItem = PromotionWithProducts & {
  effectiveStatus: PromotionStatus;
  productCount: number;
};

export default async function PromotionsPage() {
  const promotions = await getMerchantPromotions();
  const now = new Date();

  // Le statut affiché (active/programmée/expirée/désactivée) est DÉRIVÉ des
  // dates à la lecture — aucun cron nécessaire.
  const items: PromotionListItem[] = promotions.map((p) => ({
    ...p,
    effectiveStatus: effectivePromotionStatus(
      { status: p.status, startsAt: p.starts_at, endsAt: p.ends_at },
      now
    ),
    productCount: p.promotion_products?.length ?? 0,
  }));

  return <PromotionsView items={items} />;
}
