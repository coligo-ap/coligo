"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { reportDriver } from "@/app/(customer)/commandes/reviews/actions";

/**
 * Signaler le livreur (client) — motif + détails facultatifs.
 *
 * Confidentiel : le livreur n'est jamais informé qu'il a été signalé (RLS). Un
 * seul signalement par commande (garde côté DB). Les motifs affichés sont
 * localisés (FR/AR) mais on envoie un libellé FR canonique stable pour la
 * modération admin.
 */

const REASONS: { key: string; fr: string }[] = [
  { key: "reportReasonDisrespect", fr: "Non-respect / impolitesse" },
  { key: "reportReasonThreat", fr: "Menace / intimidation" },
  { key: "reportReasonHarassment", fr: "Harcèlement / drague" },
  { key: "reportReasonInsult", fr: "Insultes / agressivité" },
  { key: "reportReasonDangerous", fr: "Comportement dangereux" },
  { key: "reportReasonDirtyBag", fr: "Sac / matériel sale" },
  { key: "reportReasonSpilled", fr: "Commande renversée / abîmée" },
  { key: "reportReasonOther", fr: "Autre" },
];

export function ReportDriver({ orderId }: { orderId: string }) {
  const t = useTranslations("orders");
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [reasonFr, setReasonFr] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [pending, start] = useTransition();

  const submit = () => {
    if (!reasonFr) return;
    start(async () => {
      const r = await reportDriver({
        order_id: orderId,
        reason: reasonFr,
        details: details.trim() || null,
      });
      if (r.ok) {
        toast.success(t("reportSent"));
        setDone(true);
        setOpen(false);
      } else {
        toast.error(r.error);
        if (r.error?.includes("déjà")) setDone(true);
      }
    });
  };

  if (done) {
    return (
      <p className="text-muted mt-3 flex items-center justify-center gap-1.5 text-[12px] font-semibold">
        <ShieldAlert className="size-3.5" />
        {t("reportSentBadge")}
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted hover:text-danger-700 mt-3 flex w-full items-center justify-center gap-1.5 text-[12.5px] font-semibold"
      >
        <AlertTriangle className="size-3.5" />
        {t("reportDriverCta")}
      </button>

      {open && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="max-h-[88vh] w-full max-w-sm overflow-y-auto rounded-[20px] bg-white p-5 shadow-2xl">
            <div className="bg-danger-100 text-danger-700 mx-auto grid size-12 place-items-center rounded-full">
              <ShieldAlert className="size-6" />
            </div>
            <h3 className="text-foreground mt-3 text-center text-[17px] font-black">
              {t("reportDriverTitle")}
            </h3>
            <p className="text-muted mt-1 text-center text-[12.5px] font-medium">
              {t("reportDriverIntro")}
            </p>

            <div className="mt-4 flex flex-col gap-1.5">
              {REASONS.map((r) => {
                const active = reasonFr === r.fr;
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setReasonFr(r.fr)}
                    className={
                      "flex items-center justify-between rounded-[12px] border px-3.5 py-2.5 text-left text-[13.5px] font-semibold transition-colors " +
                      (active
                        ? "border-danger-400 bg-danger-50 text-danger-800"
                        : "border-border text-foreground hover:bg-surface-2")
                    }
                  >
                    {t(r.key)}
                    {active && <Check className="text-danger-600 size-4" />}
                  </button>
                );
              })}
            </div>

            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
              rows={3}
              placeholder={t("reportDetailsPlaceholder")}
              className="border-border bg-surface-2 text-foreground mt-3 w-full resize-none rounded-[12px] border px-3 py-2.5 text-[13px] outline-none"
            />

            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={submit}
                disabled={pending || !reasonFr}
                className="bg-danger-600 hover:bg-danger-700 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] text-[15px] font-extrabold text-white disabled:opacity-50"
              >
                {pending ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <AlertTriangle className="size-5" />
                )}
                {t("reportSubmit")}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="text-muted h-11 w-full text-[14px] font-semibold disabled:opacity-50"
              >
                {t("reportCancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
