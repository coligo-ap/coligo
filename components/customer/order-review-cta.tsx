"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Star } from "lucide-react";
import { ReviewModal } from "@/components/customer/review-modal";

// =============================================================================
// OrderReviewCta — pastille "Laisser un avis" affichée sur les commandes
// completed sans avis dans la liste /commandes.
// =============================================================================
// Petit, discret, à droite du badge statut. Clic → ouverture de ReviewModal.
// Non-destructif : empêche la propagation du clic vers le Link parent (Row).
// =============================================================================

type Props = {
  orderId: string;
  merchantName: string;
};

export function OrderReviewCta({ orderId, merchantName }: Props) {
  const t = useTranslations("orders");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 hover:bg-amber-100"
      >
        <Star className="size-3 fill-amber-400 text-amber-400" />
        {t("leaveReview")}
      </button>
      {open && (
        <ReviewModal
          orderId={orderId}
          merchantName={merchantName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
