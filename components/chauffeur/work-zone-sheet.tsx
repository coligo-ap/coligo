"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { Crosshair, X } from "lucide-react";
import {
  useSearchRadius,
  setSearchRadius,
  SEARCH_RADIUS_OPTIONS,
} from "@/lib/chauffeur/work-zone";

/**
 * Modale « Ma zone » du CHAUFFEUR. Le dispatch est TOUJOURS centré sur la
 * position GPS actuelle du chauffeur (mig 0201) ; cette modale ne règle que le
 * RAYON autour de lui (3 km par défaut, jusqu'à 20 km). Si peu de demandes dans
 * ce rayon, le système élargit automatiquement aux courses les plus proches
 * au-delà — libre au chauffeur de les accepter ou non.
 */
export function ChauffeurWorkZoneSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const current = useSearchRadius();
  const [radius, setRadius] = useState<number>(current);

  if (!open) return null;

  const save = () => {
    setSearchRadius(radius);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center sm:items-center"
      style={{ background: "rgba(8,9,16,.55)" }}
      onClick={onClose}
    >
      <div
        className="bg-surface text-foreground w-full max-w-md overflow-hidden rounded-t-[22px] shadow-2xl sm:rounded-[22px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-border flex items-center justify-between border-b px-4 py-3.5">
          <div className="flex items-center gap-2">
            <Crosshair className="text-primary-700 size-[18px]" />
            <h2 className="drive-sora text-[16px] font-extrabold">
              {tr("Ma zone", "منطقتي")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="text-subtle hover:text-foreground -mr-1 p-1"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="p-4">
          <p className="text-muted mb-4 text-[13px] leading-snug">
            {tr(
              "Vous recevez les courses autour de votre position actuelle, où que vous soyez. Choisissez la distance maximale. Si peu de demandes sont proches, on vous proposera aussi les plus proches au-delà.",
              "تستقبل الطلبات حول موقعك الحالي أينما كنت. اختر المسافة القصوى. وإذا قلّت الطلبات القريبة، سنقترح عليك أيضًا الأقرب خارج هذا النطاق."
            )}
          </p>

          <div className="text-subtle mb-2 text-[12px] font-bold tracking-wide uppercase">
            {tr("Rayon autour de moi", "نصف القطر حولي")}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {SEARCH_RADIUS_OPTIONS.map((r) => {
              const active = r === radius;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRadius(r)}
                  className={
                    "h-11 rounded-[12px] border text-[14px] font-bold transition " +
                    (active
                      ? "border-primary-600 bg-primary-600 text-white"
                      : "border-border bg-surface-2 text-foreground")
                  }
                >
                  {r} km
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={save}
            className="bg-primary-600 mt-5 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] text-[15px] font-bold text-white shadow-lg"
          >
            <Crosshair className="size-[18px]" />
            {tr("Enregistrer", "حفظ")}
          </button>
        </div>
      </div>
    </div>
  );
}
