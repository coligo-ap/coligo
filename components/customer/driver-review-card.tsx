"use client";

import { useState, useTransition } from "react";
import { Loader2, Star } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { submitDriverReview } from "@/app/(customer)/commandes/reviews/actions";

// =============================================================================
// DriverReviewCard — notation du LIVREUR d'une commande livrée (1 à 5 étoiles
// + commentaire optionnel). Affichée sur le détail commande quand la commande
// est livrée (completed) et qu'un livreur y était assigné.
// =============================================================================

const MAX_COMMENT = 500;
const LABELS = ["Décevant", "Bof", "Correct", "Très bien", "Excellent !"];

export function DriverReviewCard({
  orderId,
  driverName,
  initialRating,
}: {
  orderId: string;
  driverName: string;
  /** Note déjà laissée (lecture seule) ou null si pas encore noté. */
  initialRating: number | null;
}) {
  const [submitted, setSubmitted] = useState<number | null>(initialRating);
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();

  if (submitted != null) {
    return (
      <div className="border-border bg-surface mt-5 rounded-[16px] border p-5">
        <p className="text-muted text-xs font-semibold tracking-wider uppercase">
          Ton avis sur le livreur
        </p>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star
                key={n}
                className={cn(
                  "size-5",
                  submitted >= n
                    ? "fill-amber-400 text-amber-400"
                    : "text-border-strong fill-transparent"
                )}
              />
            ))}
          </div>
          <span className="text-muted text-sm">Merci pour ton retour 🙏</span>
        </div>
      </div>
    );
  }

  const submit = () => {
    if (rating < 1) {
      toast.error("Choisis une note de 1 à 5 étoiles.");
      return;
    }
    start(async () => {
      const res = await submitDriverReview({
        order_id: orderId,
        rating,
        comment: comment.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Merci pour ton avis sur le livreur !");
      setSubmitted(rating);
    });
  };

  return (
    <div className="border-border bg-surface mt-5 rounded-[16px] border p-5">
      <h2 className="text-foreground text-base font-semibold">
        Comment s&apos;est passée la livraison ?
      </h2>
      <p className="text-muted mt-0.5 text-xs">
        Ton avis sur <span className="font-semibold">{driverName}</span> aide à
        garder un service de qualité.
      </p>

      <div
        className="flex items-center justify-center gap-2 py-3"
        role="radiogroup"
        aria-label="Note livreur (1 à 5 étoiles)"
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = (hovered || rating) >= n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} étoile${n > 1 ? "s" : ""}`}
              onMouseEnter={() => setHovered(n)}
              onMouseLeave={() => setHovered(0)}
              onClick={() => setRating(n)}
              className="rounded-full p-1 transition-transform hover:scale-110 active:scale-95"
            >
              <Star
                className={cn(
                  "size-8 transition-colors",
                  filled
                    ? "fill-amber-400 text-amber-400"
                    : "text-border-strong fill-transparent"
                )}
              />
            </button>
          );
        })}
      </div>
      {rating > 0 && (
        <p className="text-muted text-center text-xs">{LABELS[rating - 1]}</p>
      )}

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
        rows={2}
        placeholder="Un mot sur le livreur (optionnel)…"
        className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 mt-3 w-full rounded-[12px] border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
      />

      <button
        type="button"
        onClick={submit}
        disabled={pending || rating < 1}
        className="bg-primary-600 hover:bg-primary-700 mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          "Noter le livreur"
        )}
      </button>
    </div>
  );
}
