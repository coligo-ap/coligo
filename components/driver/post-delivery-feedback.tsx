"use client";

import { useState, useTransition } from "react";
import { useLocale } from "next-intl";
import { Check, Flag, Loader2, Star } from "lucide-react";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { rateCustomer, reportCustomer } from "@/app/(driver)/actions";

/**
 * Retour livreur après une livraison validée : noter le client (1..5 + mot) et,
 * en option, signaler un problème. Le livreur peut « Passer ». Le client ne voit
 * jamais sa note ni le signalement (confidentiel, géré côté DB/RLS).
 */

// Le `fr` est la valeur ENVOYÉE au serveur (cohérence des données) ; `ar` est
// l'affichage côté livreur arabophone.
const REASONS = [
  { fr: "Client injoignable / absent", ar: "الزبون غير متاح / غائب" },
  { fr: "Adresse incorrecte / introuvable", ar: "عنوان خاطئ / غير موجود" },
  { fr: "Comportement irrespectueux", ar: "سلوك غير لائق" },
  { fr: "Refus de payer le reste dû", ar: "رفض دفع المبلغ المتبقّي" },
  { fr: "Autre", ar: "أخرى" },
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
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [note, setNote] = useActionNote();
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setNote(null);
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
      // Succès : on ferme (le « merci » n'a pas besoin de survivre). En cas
      // d'échec partiel, on GARDE la fenêtre ouverte avec un message inline.
      if (okAll) {
        onDone();
        return;
      }
      setNote({
        ok: false,
        text: tr(
          "Une partie n'a pas pu être enregistrée.",
          "تعذّر حفظ جزء منها."
        ),
      });
    });

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center">
      <div className="rounded-sheet-xl max-h-[90vh] w-full max-w-md overflow-y-auto bg-[var(--surface)] p-5 text-[var(--ink)]">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-[var(--go-soft)] text-[var(--go)]">
          <Check className="size-7" />
        </div>
        <h3 className="text-heading-sm mt-3 text-center font-black">
          {tr("Livraison validée", "تم تأكيد التسليم")}
        </h3>
        <p className="text-body-sm mt-1 text-center font-medium text-[var(--muted)]">
          {tr("Comment s'est passée la course", "كيف كانت التوصيلة")}
          {customerName
            ? isAr
              ? ` مع ${customerName}`
              : ` avec ${customerName}`
            : ""}{" "}
          ?
        </p>

        {/* Étoiles */}
        <div className="mt-4 flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              aria-label={isAr ? `${n} نجمة` : `${n} étoile${n > 1 ? "s" : ""}`}
              className="active:scale-90"
            >
              <Star
                className="size-9"
                style={{
                  color: n <= rating ? "#f59e0b" : "var(--line)",
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
            placeholder={tr(
              "Un commentaire ? (facultatif)",
              "تعليق؟ (اختياري)"
            )}
            className="text-body-sm mt-3 w-full resize-none rounded-md border border-[var(--line)] bg-[var(--soft)] px-3 py-2.5 outline-none"
          />
        )}

        {/* Signaler un problème */}
        {!reporting ? (
          <button
            type="button"
            onClick={() => setReporting(true)}
            className="text-label-lg mt-3 flex w-full items-center justify-center gap-1.5 font-bold text-[var(--red)]"
          >
            <Flag className="size-3.5" />
            {tr(
              "Signaler un problème avec le client",
              "الإبلاغ عن مشكلة مع الزبون"
            )}
          </button>
        ) : (
          <div className="rounded-card-lg mt-3 border border-[var(--red)]/30 bg-[var(--red-soft)] p-3">
            <p className="text-label mb-2 font-extrabold tracking-wide text-[var(--red)] uppercase">
              {tr("Signalement", "إبلاغ")}
            </p>
            <div className="flex flex-col gap-1.5">
              {REASONS.map((r) => {
                const active = reason === r.fr;
                return (
                  <button
                    key={r.fr}
                    type="button"
                    onClick={() => setReason(r.fr)}
                    className={
                      "rounded-control text-body-sm flex items-center justify-between border px-3 py-2 text-left font-semibold " +
                      (active
                        ? "border-[var(--red)] bg-[var(--surface)] text-[var(--red)]"
                        : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]")
                    }
                  >
                    {isAr ? r.ar : r.fr}
                    {active && <Check className="size-4" />}
                  </button>
                );
              })}
            </div>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
              rows={2}
              placeholder={tr("Détails (facultatif)", "تفاصيل (اختياري)")}
              className="rounded-control text-body-sm mt-2 w-full resize-none border border-[var(--line)] bg-[var(--surface)] px-3 py-2 outline-none"
            />
          </div>
        )}

        <ActionNote note={note} className="mt-3 text-center" />

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-card-lg text-title-sm inline-flex h-12 w-full items-center justify-center gap-2 font-extrabold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#5b2eff,#6c2bd9)" }}
          >
            {pending ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              tr("Valider", "تأكيد")
            )}
          </button>
          <button
            type="button"
            onClick={onDone}
            disabled={pending}
            className="text-body-lg h-11 w-full font-semibold text-[var(--muted)] disabled:opacity-50"
          >
            {tr("Passer", "تخطّي")}
          </button>
        </div>
      </div>
    </div>
  );
}
