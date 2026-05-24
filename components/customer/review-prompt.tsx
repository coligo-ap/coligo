"use client";

import Link from "next/link";
import { useState } from "react";
import { Star } from "lucide-react";
import { cldUrl } from "@/lib/images/cloudinary";
import { ReviewModal } from "@/components/customer/review-modal";
import type { ReviewableOrder } from "@/lib/data/reviews";

// =============================================================================
// ReviewPrompt — encart compact sur la home (UNE seule commande à noter).
// =============================================================================
// On évite délibérément d'enchaîner plusieurs encarts pour ne pas pousser la
// liste des commerces hors viewport (priorité absolue : que le client voie
// les commerces immédiatement). Le reste des commandes à noter est accessible
// via /commandes (bouton "Laisser un avis" sur chaque ligne completed).
// =============================================================================

type Props = {
  orders: ReviewableOrder[];
};

export function ReviewPrompt({ orders }: Props) {
  const [active, setActive] = useState<ReviewableOrder | null>(null);
  if (orders.length === 0) return null;
  const o = orders[0]; // 1 seule commande à la fois sur la home
  const logo = cldUrl(o.merchant_logo_url, {
    width: 56,
    height: 56,
    crop: "fill",
    gravity: "auto",
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setActive(o)}
        className="group flex w-full items-center gap-3 rounded-[14px] border border-amber-200 bg-amber-50 p-3 text-left transition-all hover:border-amber-300 hover:shadow-md hover:shadow-amber-100 active:scale-[0.99]"
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-11 shrink-0 rounded-full border border-amber-200 bg-white object-cover"
          />
        ) : (
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-base font-bold text-amber-700">
            {o.merchant_name.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-sm font-semibold">
            Comment c&apos;était chez {o.merchant_name} ?
          </p>
          <div className="mt-0.5 flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star
                key={n}
                className="size-3.5 fill-amber-300 text-amber-400"
              />
            ))}
            <span className="text-muted ml-1 text-[11px]">Note en 1 clic</span>
          </div>
        </div>
        <Link
          href="/commandes"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 text-[11px] font-semibold text-amber-700 hover:underline"
        >
          Autres ?
        </Link>
      </button>

      {active && (
        <ReviewModal
          orderId={active.order_id}
          merchantName={active.merchant_name}
          onClose={() => setActive(null)}
        />
      )}
    </>
  );
}
