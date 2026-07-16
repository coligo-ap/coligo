"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
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
  const [note, setNote] = useActionNote();
  const [pending, start] = useTransition();
  const t = useTranslations("reviews");

  function submit() {
    if (rating < 1) {
      setNote({ ok: false, text: t("pickRatingError") });
      return;
    }
    start(async () => {
      setNote(null);
      const res = await submitReview({
        order_id: orderId,
        rating,
        comment: comment.trim() || null,
      });
      if (!res.ok) {
        setNote({ ok: false, text: res.error });
        return;
      }
      // Modale fermée + parent rafraîchi (l'avis apparaît) = retour visuel.
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
      <div className="bg-surface w-full max-w-md rounded-t-[20px] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-[20px] sm:pb-5">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-foreground text-lg font-bold">
              {t("howWasIt")}
            </h2>
            <p className="text-muted mt-0.5 text-xs">
              {t.rich("reviewHelpsOthers", {
                merchant: merchantName,
                b: (chunks) => <span className="font-semibold">{chunks}</span>,
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:bg-surface-2 rounded-full p-1.5"
            aria-label={t("close")}
          >
            <X className="size-4" />
          </button>
        </header>

        {/* Étoiles interactives — tap/hover */}
        <div
          className="flex items-center justify-center gap-2 py-3"
          role="radiogroup"
          aria-label={t("ratingGroupLabel")}
        >
          {[1, 2, 3, 4, 5].map((n) => {
            const filled = (hovered || rating) >= n;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={
                  n > 1 ? t("starsCount", { count: n }) : t("starSingular")
                }
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
            {t(`ratingLabel_${rating}`)}
          </p>
        )}

        <label className="text-foreground mt-4 block text-xs font-semibold tracking-wider uppercase">
          {t("commentOptional")}
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
          rows={3}
          placeholder={t("commentPlaceholder")}
          className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 mt-1.5 w-full rounded-[12px] border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        />
        <p className="text-subtle mt-1 text-end text-[10px]">
          {comment.length}/{MAX_COMMENT}
        </p>

        <ActionNote note={note} className="mt-2 text-center" />

        <div className="mt-4 flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={pending}
            className="flex-1"
          >
            {t("cancel")}
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
              t("submitReview")
            )}
          </Button>
        </div>

        <p className="text-subtle mt-3 text-center text-[10px]">
          {t("editWindowNotice")}
        </p>
      </div>
    </div>
  );
}
