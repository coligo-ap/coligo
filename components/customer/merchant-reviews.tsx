import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { RatingStars } from "@/components/customer/rating-stars";
import type { ReviewWithCustomer } from "@/lib/data/reviews";

// =============================================================================
// MerchantReviews — section "Avis clients" sur la fiche commerce.
// =============================================================================
// Server Component : la liste vient déjà filtrée (is_hidden=false) côté DB.
// Anonymisation partielle : "Mehdi B." au lieu du nom complet.
// =============================================================================

type Props = {
  ratingAvg: number;
  ratingCount: number;
  reviews: ReviewWithCustomer[];
};

export function MerchantReviews({ ratingAvg, ratingCount, reviews }: Props) {
  // Pas d'avis → on n'affiche rien (pas de placeholder "0 étoile"
  // décourageant pour les nouveaux commerces).
  if (ratingCount === 0) return null;

  return (
    <section className="mt-8">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-foreground text-xl font-bold">
          Avis clients
        </h2>
        <RatingStars avg={ratingAvg} count={ratingCount} size="md" />
      </header>

      {reviews.length === 0 ? (
        <p className="text-muted text-sm">
          Aucun commentaire à afficher (les notes restent comptées).
        </p>
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <ReviewItem key={r.id} review={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReviewItem({ review }: { review: ReviewWithCustomer }) {
  const displayName = anonymize(review.customer_name);
  const date = new Date(review.created_at).toLocaleDateString("fr-DZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <li className="border-border bg-surface rounded-[14px] border p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-foreground text-sm font-semibold">{displayName}</p>
          <p className="text-muted text-xs">
            {date}
            {review.edited_at && (
              <span className="text-subtle"> · modifié</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              className={cn(
                "size-4",
                n <= review.rating
                  ? "fill-amber-400 text-amber-400"
                  : "text-border-strong fill-transparent"
              )}
            />
          ))}
        </div>
      </header>
      {review.comment && (
        <p className="text-foreground mt-2 text-sm leading-relaxed">
          {review.comment}
        </p>
      )}
    </li>
  );
}

/** "Mehdi B." — anonymisation partielle pour respecter la vie privée. */
function anonymize(fullName: string | null): string {
  if (!fullName) return "Client Coligo";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}
