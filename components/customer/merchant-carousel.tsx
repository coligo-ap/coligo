import Link from "next/link";
import { Flame } from "lucide-react";
import { StoreCardCompact } from "@/components/customer/store-card-compact";
import type { PublicMerchant, PromoLabel } from "@/lib/data/merchants-public";

// =============================================================================
// MerchantCarousel — carrousel scroll-snap horizontal de commerces.
// =============================================================================
// Utilisé pour la section « Populaires près de toi 🔥 ».
// Pas de flèches au survol pour MVP (scroll natif marche partout). On peut
// ajouter des chevrons sur desktop dans une itération suivante.
// =============================================================================

type Props = {
  merchants: PublicMerchant[];
  /** IDs des commerces qui ont une promotion active — pour le badge PROMO. */
  promoIds: Set<string>;
  /** Détail des promos (− %, code…) par merchant_id. */
  promoLabels?: Record<string, PromoLabel>;
  /** Lien "Tout voir" — vers la home filtrée ou similaire. */
  seeAllHref?: string;
};

export function MerchantCarousel({
  merchants,
  promoIds,
  promoLabels,
  seeAllHref,
}: Props) {
  if (merchants.length === 0) return null;

  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="font-display text-foreground text-lg font-bold lg:text-xl">
          <Flame className="text-coral-500 -mt-1 mr-1 inline size-5" />
          Populaires près de toi
        </h2>
        {seeAllHref && (
          <Link
            href={seeAllHref}
            className="text-primary-700 text-xs font-semibold hover:underline"
          >
            Tout voir →
          </Link>
        )}
      </header>

      <div
        className="-mx-4 flex snap-x snap-mandatory [scrollbar-width:none] gap-3 overflow-x-auto px-4 pb-2 lg:-mx-6 lg:px-6 [&::-webkit-scrollbar]:hidden"
        aria-label="Commerces populaires"
      >
        {merchants.map((m) => (
          <StoreCardCompact
            key={m.id}
            merchant={m}
            hasPromo={promoIds.has(m.id)}
            promoLabel={promoLabels?.[m.id]?.text ?? null}
          />
        ))}
      </div>
    </section>
  );
}
