"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { Crosshair, MapPin, X } from "lucide-react";
import { MapPositionPicker } from "@/components/shared/map-position-picker";
import {
  useWorkZone,
  setWorkZone,
  ZONE_RADIUS_OPTIONS,
  DEFAULT_ZONE_RADIUS_KM,
} from "@/lib/driver/work-zone";

/**
 * Modale « Ma zone de travail ». Le livreur choisit un CENTRE sur la carte
 * (déplacement / recherche / GPS, via MapPositionPicker) et un RAYON, puis
 * active la zone : il ne reçoit plus que les courses Express de ce périmètre.
 *
 * « Autour de moi » efface la zone → retour au dispatch suivant le GPS live.
 */
export function WorkZoneSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const current = useWorkZone();
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(
    current ? { lat: current.lat, lng: current.lng } : null
  );
  const [radius, setRadius] = useState<number>(
    current?.radiusKm ?? DEFAULT_ZONE_RADIUS_KM
  );

  if (!open) return null;

  const activate = () => {
    if (!center) return;
    setWorkZone({ lat: center.lat, lng: center.lng, radiusKm: radius });
    onClose();
  };

  const useAroundMe = () => {
    setWorkZone(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center sm:items-center"
      style={{ background: "rgba(8,9,16,.55)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-t-[22px] bg-[var(--surface)] text-[var(--ink)] shadow-2xl sm:rounded-[22px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3.5">
          <div className="flex items-center gap-2">
            <MapPin
              className="size-[18px]"
              style={{ color: "var(--violet)" }}
            />
            <h2 className="mq-sora text-[16px] font-extrabold">
              {tr("Ma zone de travail", "منطقة عملي")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr("Fermer", "إغلاق")}
            className="-mr-1 p-1 text-[var(--muted)] hover:text-[var(--ink)]"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="p-4">
          <p className="mb-3 text-[13px] leading-snug text-[var(--muted)]">
            {tr(
              "Choisissez le centre de votre zone et un rayon. Vous ne recevrez que les courses Express de ce périmètre, où que vous soyez.",
              "اختر مركز منطقتك ونصف القطر. لن تصلك إلا توصيلات السريع ضمن هذا المحيط، أينما كنت."
            )}
          </p>

          {/* Carte de sélection du centre (réutilise le picker partagé). */}
          <MapPositionPicker
            initial={current ? { lat: current.lat, lng: current.lng } : null}
            autoLocate={!current}
            searchEnabled
            searchPlaceholder={tr(
              "Rechercher un quartier, une ville…",
              "ابحث عن حيّ أو مدينة…"
            )}
            gpsLabel={tr("Ma position", "موقعي")}
            height={260}
            onChange={(pos) => setCenter(pos)}
          />

          {/* Sélecteur de rayon */}
          <div className="mt-4">
            <div className="mb-2 text-[12px] font-bold tracking-wide text-[var(--muted)] uppercase">
              {tr("Rayon de la zone", "نصف قطر المنطقة")}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {ZONE_RADIUS_OPTIONS.map((r) => {
                const active = r === radius;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRadius(r)}
                    className="h-11 rounded-[12px] border text-[14px] font-bold transition"
                    style={
                      active
                        ? {
                            borderColor: "var(--violet)",
                            background: "var(--violet)",
                            color: "#fff",
                          }
                        : {
                            borderColor: "var(--line)",
                            background: "var(--soft)",
                            color: "var(--ink)",
                          }
                    }
                  >
                    {r} km
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={activate}
              disabled={!center}
              className="inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] text-[15px] font-bold text-white disabled:opacity-50"
              style={{
                background: "var(--violet)",
                boxShadow: "0 14px 28px -12px var(--violet-glow)",
              }}
            >
              <MapPin className="size-[18px]" />
              {tr("Activer cette zone", "تفعيل هذه المنطقة")}
            </button>
            <button
              type="button"
              onClick={useAroundMe}
              className="inline-flex h-[48px] w-full items-center justify-center gap-2 rounded-[14px] border border-[var(--line)] text-[14px] font-semibold text-[var(--ink)]"
            >
              <Crosshair className="size-[16px]" />
              {tr("Autour de moi (position GPS)", "حولي (موقع GPS)")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
