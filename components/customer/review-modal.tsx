"use client";

import { useState, useTransition } from "react";
import { Loader2, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { submitReview } from "@/app/(customer)/commandes/reviews/actions";

// =============================================================================
// ReviewModal — modale 5 étoiles + commentaire optionnel (max 500c).
// =============================================================================
// Soumission via Server Action `submitReview`. La validation finale est faite
// serveur (RLS + trigger) ; ici on filtre les saisies absurdes.
// =============================================================================

type Props = {
  orderId: string;
  merchantName: string;
  /** Appelé après soumission réussie pour fermer la modale + rafraîchir. */
  onClose: () => void;
};

const MAX_COMMENT = 500;

export function ReviewModal({ orderId, merchantName, onClose }: Props) {
  const [rating, setRating] = useState<number>(0);
  const [hovered, setHovered] = useState<number>(0);
  const [comment, setComment] = useState<string>("");
  const [pending, start] = useTransition();

  function submit() {
    if (rating < 1) {
      toast.error("Choisis une note de 1 à 5 étoiles.");
      return;
    }
    start(async () => {
      const res = await submitReview({
        order_id: orderId,
        rating,
        comment: comment.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Merci pour ton avis !");
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface w-full max-w-md rounded-t-[20px] p-5 shadow-xl sm:rounded-[20px]">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-foreground text-lg font-bold">
              Comment s&apos;est passé ?
            </h2>
            <p className="text-muted mt-0.5 text-xs">
              Ton avis sur <span className="font-semibold">{merchantName}</span>{" "}
              aide les autres clients.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:bg-surface-2 rounded-full p-1.5"
            aria-label="Fermer"
          >
            <X className="size-4" />
          </button>
        </header>

        {/* Étoiles interactives — tap/hover */}
        <div
          className="flex items-center justify-center gap-2 py-3"
          role="radiogroup"
          aria-label="Note (1 à 5 étoiles)"
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
                    "size-9 transition-colors",
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
          <p className="text-muted text-center text-xs">
            {RATING_LABELS[rating - 1]}
          </p>
        )}

        <label className="text-foreground mt-4 block text-xs font-semibold tracking-wider uppercase">
          Commentaire (optionnel)
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
          rows={3}
          placeholder="Ex. : très bon pain, accueil chaleureux…"
          className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 mt-1.5 w-full rounded-[12px] border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        />
        <p className="text-subtle mt-1 text-right text-[10px]">
          {comment.length}/{MAX_COMMENT}
        </p>

        <div className="mt-4 flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={pending}
            className="flex-1"
          >
            Annuler
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || rating < 1}
            className="flex-1"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Envoyer mon avis"
            )}
          </Button>
        </div>

        <p className="text-subtle mt-3 text-center text-[10px]">
          Tu pourras modifier ton avis pendant 24h après envoi.
        </p>
      </div>
    </div>
  );
}

const RATING_LABELS = [
  "Décevant",
  "Bof",
  "Correct",
  "Très bien",
  "Excellent !",
];
