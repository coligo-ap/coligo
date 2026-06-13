"use client";

import { useState } from "react";
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
        className="bg-surface text-foreground w-full max-w-md overflow-hidden rounded-t-[22px] shadow-2xl sm:rounded-[22px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="border-border flex items-center justify-between border-b px-4 py-3.5">
          <div className="flex items-center gap-2">
            <MapPin className="text-primary-700 size-[18px]" />
            <h2 className="mq-sora text-[16px] font-extrabold">
              Ma zone de travail
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
          <p className="text-muted mb-3 text-[13px] leading-snug">
            Choisissez le centre de votre zone et un rayon. Vous ne recevrez que
            les courses Express de ce périmètre, où que vous soyez.
          </p>

          {/* Carte de sélection du centre (réutilise le picker partagé). */}
          <MapPositionPicker
            initial={current ? { lat: current.lat, lng: current.lng } : null}
            autoLocate={!current}
            searchEnabled
            searchPlaceholder="Rechercher un quartier, une ville…"
            gpsLabel="Ma position"
            height={260}
            onChange={(pos) => setCenter(pos)}
          />

          {/* Sélecteur de rayon */}
          <div className="mt-4">
            <div className="text-subtle mb-2 text-[12px] font-bold tracking-wide uppercase">
              Rayon de la zone
            </div>
            <div className="grid grid-cols-4 gap-2">
              {ZONE_RADIUS_OPTIONS.map((r) => {
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
          </div>

          {/* Actions */}
          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={activate}
              disabled={!center}
              className="bg-primary-600 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] text-[15px] font-bold text-white shadow-lg disabled:opacity-50"
            >
              <MapPin className="size-[18px]" />
              Activer cette zone
            </button>
            <button
              type="button"
              onClick={useAroundMe}
              className="border-border text-foreground inline-flex h-[48px] w-full items-center justify-center gap-2 rounded-[14px] border text-[14px] font-semibold"
            >
              <Crosshair className="size-[16px]" />
              Autour de moi (position GPS)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
