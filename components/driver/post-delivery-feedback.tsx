"use client";

import { useState, useTransition } from "react";
import { Check, Flag, Loader2, Star } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { rateCustomer, reportCustomer } from "@/app/(driver)/actions";

/**
 * Retour livreur après une livraison validée : noter le client (1..5 + mot) et,
 * en option, signaler un problème. Le livreur peut « Passer ». Le client ne voit
 * jamais sa note ni le signalement (confidentiel, géré côté DB/RLS).
 */

const REASONS = [
  "Client injoignable / absent",
  "Adresse incorrecte / introuvable",
  "Comportement irrespectueux",
  "Refus de payer le reste dû",
  "Autre",
];

export function PostDeliveryFeedback({
  orderId,
  customerName,
  onDone,
}: {
  orderId: string;
  customerName: string | null;
  onDone: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      let okAll = true;
      if (rating > 0) {
        const r = await rateCustomer({
          orderId,
          rating,
          comment: comment.trim() || null,
        });
        if (!r.ok && r.reason !== "already_rated") okAll = false;
      }
      if (reporting && reason) {
        const r = await reportCustomer({
          orderId,
          reason,
          details: details.trim() || null,
        });
        if (!r.ok && r.reason !== "already_reported") okAll = false;
      }
      if (okAll) toast.success("Merci pour ton retour ✓");
      else toast.error("Une partie n'a pas pu être enregistrée.");
      onDone();
    });

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[22px] bg-white p-5 text-[#0a0a0a]">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-[#ecfdf5] text-[#059669]">
          <Check className="size-7" />
        </div>
        <h3 className="mt-3 text-center text-[18px] font-black">
          Livraison validée
        </h3>
        <p className="mt-1 text-center text-[13px] font-medium text-[#757575]">
          Comment s&apos;est passée la course
          {customerName ? ` avec ${customerName}` : ""} ?
        </p>

        {/* Étoiles */}
        <div className="mt-4 flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              aria-label={`${n} étoile${n > 1 ? "s" : ""}`}
              className="active:scale-90"
            >
              <Star
                className="size-9"
                style={{
                  color: n <= rating ? "#f59e0b" : "#d4d4d4",
                  fill: n <= rating ? "#f59e0b" : "transparent",
                }}
              />
            </button>
          ))}
        </div>

        {rating > 0 && (
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, 500))}
            rows={2}
            placeholder="Un commentaire ? (facultatif)"
            className="mt-3 w-full resize-none rounded-[12px] border border-black/10 bg-[#fafafa] px-3 py-2.5 text-[13px] outline-none"
          />
        )}

        {/* Signaler un problème */}
        {!reporting ? (
          <button
            type="button"
            onClick={() => setReporting(true)}
            className="mt-3 flex w-full items-center justify-center gap-1.5 text-[12.5px] font-bold text-[#e53935]"
          >
            <Flag className="size-3.5" />
            Signaler un problème avec le client
          </button>
        ) : (
          <div className="mt-3 rounded-[14px] border border-[#e53935]/30 bg-[#fff5f5] p-3">
            <p className="mb-2 text-[12px] font-extrabold tracking-wide text-[#e53935] uppercase">
              Signalement
            </p>
            <div className="flex flex-col gap-1.5">
              {REASONS.map((r) => {
                const active = reason === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    className={
                      "flex items-center justify-between rounded-[10px] border px-3 py-2 text-left text-[13px] font-semibold " +
                      (active
                        ? "border-[#e53935] bg-white text-[#e53935]"
                        : "border-black/10 bg-white text-[#0a0a0a]")
                    }
                  >
                    {r}
                    {active && <Check className="size-4" />}
                  </button>
                );
              })}
            </div>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
              rows={2}
              placeholder="Détails (facultatif)"
              className="mt-2 w-full resize-none rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[13px] outline-none"
            />
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] text-[15px] font-extrabold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#6d6df0,#5c5ce0)" }}
          >
            {pending ? <Loader2 className="size-5 animate-spin" /> : "Valider"}
          </button>
          <button
            type="button"
            onClick={onDone}
            disabled={pending}
            className="h-11 w-full text-[14px] font-semibold text-[#757575] disabled:opacity-50"
          >
            Passer
          </button>
        </div>
      </div>
    </div>
  );
}
