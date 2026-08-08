"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { Crosshair, X } from "lucide-react";
import { Portal } from "@/components/ui/portal";
import { BRAND_VIOLET } from "@/components/shared/partner-ui";
import {
  useSearchRadius,
  setSearchRadius,
  SEARCH_RADIUS_OPTIONS,
} from "@/lib/chauffeur/work-zone";

/**
 * Modale « Ma zone » du CHAUFFEUR. Le dispatch est TOUJOURS centré sur la
 * position GPS actuelle du chauffeur (mig 0201) ; cette modale ne règle que le
 * RAYON autour de lui (5 km par défaut et minimum, jusqu'à 20 km). Si peu de demandes dans
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
    <Portal>
      <div
        className="fixed inset-0 z-[110] flex items-end justify-center sm:items-center"
        style={{ background: "rgba(8,9,16,.55)" }}
        onClick={onClose}
      >
        <div
          className="drive-jakarta rounded-t-sheet-xl sm:rounded-sheet-xl w-full max-w-[560px] overflow-hidden bg-[var(--d-surface)] pb-[calc(0px+env(safe-area-inset-bottom))] text-[var(--d-ink)] shadow-2xl sm:pb-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-[var(--d-line)] px-4 py-3.5">
            <div className="flex items-center gap-2">
              <Crosshair
                className="size-[18px]"
                style={{ color: BRAND_VIOLET }}
              />
              <h2 className="drive-sora text-title font-extrabold">
                {tr("Ma zone", "منطقتي")}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="-mr-1 p-1 text-[var(--d-muted)] hover:text-[var(--d-ink)]"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="p-4">
            <p className="text-body-sm mb-4 leading-snug text-[var(--d-muted)]">
              {tr(
                "Vous recevez les courses autour de votre position actuelle, où que vous soyez. Choisissez la distance maximale. Si peu de demandes sont proches, on vous proposera aussi les plus proches au-delà.",
                "تستقبل الطلبات حول موقعك الحالي أينما كنت. اختر المسافة القصوى. وإذا قلّت الطلبات القريبة، سنقترح عليك أيضًا الأقرب خارج هذا النطاق."
              )}
            </p>

            <div className="text-label mb-2 font-bold tracking-wide text-[var(--d-muted)] uppercase">
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
                    className="text-body-lg h-11 rounded-md border font-bold transition"
                    style={
                      active
                        ? {
                            borderColor: BRAND_VIOLET,
                            background: BRAND_VIOLET,
                            color: "#fff",
                          }
                        : {
                            borderColor: "var(--d-line)",
                            background: "var(--d-soft)",
                            color: "var(--d-ink)",
                          }
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
              className="rounded-card-lg text-title-sm mt-5 inline-flex h-[52px] w-full items-center justify-center gap-2 font-bold text-white"
              style={{
                background: BRAND_VIOLET,
                boxShadow: "0 14px 28px -12px rgba(108,43,217,.5)",
              }}
            >
              <Crosshair className="size-[18px]" />
              {tr("Enregistrer", "حفظ")}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
