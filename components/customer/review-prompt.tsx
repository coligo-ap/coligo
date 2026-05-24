"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cldUrl } from "@/lib/images/cloudinary";
import { ReviewModal } from "@/components/customer/review-modal";
import type { ReviewableOrder } from "@/lib/data/reviews";

// =============================================================================
// ReviewPrompt — encart sur la home : commandes récupérées sans avis.
// =============================================================================
// Une carte par commande à noter (jusqu'à N défini par le parent).
// Clic → ReviewModal. Le composant disparaît visuellement de lui-même quand
// l'avis est soumis (revalidatePath dans la Server Action déclenche un
// re-rendu de la home → l'order sort de getMyReviewableOrders).
// =============================================================================

type Props = {
  orders: ReviewableOrder[];
};

export function ReviewPrompt({ orders }: Props) {
  const [active, setActive] = useState<ReviewableOrder | null>(null);
  if (orders.length === 0) return null;

  return (
    <>
      <section className="space-y-2">
        <h2 className="font-display text-foreground px-1 text-base font-bold lg:text-lg">
          <Star className="-mt-1 mr-1 inline size-5 fill-amber-400 text-amber-500" />
          Donne ton avis
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {orders.map((o) => {
            const logo = cldUrl(o.merchant_logo_url, {
              width: 56,
              height: 56,
              crop: "fill",
              gravity: "auto",
            });
            return (
              <li key={o.order_id}>
                <button
                  type="button"
                  onClick={() => setActive(o)}
                  className="border-border bg-surface hover:border-primary-300 hover:shadow-primary-100 group flex w-full items-center gap-3 rounded-[14px] border p-3 text-left transition-all hover:shadow-md active:scale-[0.99]"
                >
                  {logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logo}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="border-border size-12 shrink-0 rounded-full border bg-white object-cover"
                    />
                  ) : (
                    <div className="bg-primary-100 text-primary-700 flex size-12 shrink-0 items-center justify-center rounded-full text-base font-bold">
                      {o.merchant_name.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-sm font-semibold">
                      Comment c&apos;était chez {o.merchant_name} ?
                    </p>
                    <div className="mt-0.5 flex items-center gap-0.5 text-amber-400">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className="size-3.5" />
                      ))}
                      <span className="text-muted ml-1.5 text-[11px]">
                        Note en 1 clic
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

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
