"use client";

import { useEffect } from "react";
import { ArrowRight, Bell, Check, MapPin, Star, X } from "lucide-react";
import { GO, ROSE, VIOLET } from "@/components/customer/drive/drive-modals";
import { useAlertSound, vibrate } from "@/lib/hooks/use-alert-sound";
import { isChauffeurSoundOn } from "@/lib/chauffeur/sound-store";
import { interWilayaInfo } from "@/lib/drive/interwilaya";
import type { NearbyRide } from "@/app/(chauffeur)/actions";

const fmtkm = (v: number) =>
  `${(Math.round(v * 10) / 10).toString().replace(".", ",")} km`;
const ago = (iso: string, isAr: boolean) => {
  const s = Math.max(
    5,
    Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  );
  if (s < 60) return isAr ? `قبل ${s} ث` : `il y a ${s} s`;
  return isAr
    ? `قبل ${Math.round(s / 60)} د`
    : `il y a ${Math.round(s / 60)} min`;
};

/**
 * Course entrante (maquette v13 « incoming-overlay ») : carte de notification
 * en haut de l'accueil quand le chauffeur est EN LIGNE. Anneau pulsé, barre de
 * temps (12 s), cloche animée, file d'attente. Accepter = proposer au prix
 * client ; Refuser = retirer ; Voir toutes = page Drive.
 */
export function DIncoming({
  ride,
  queueCount,
  pendingCount,
  busy,
  isAr,
  onAccept,
  onRefuse,
  onSeeAll,
  onClose,
}: {
  ride: NearbyRide;
  queueCount: number;
  pendingCount: number;
  busy: boolean;
  isAr: boolean;
  onAccept: () => void;
  onRefuse: () => void;
  onSeeAll: () => void;
  onClose: () => void;
}) {
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const price = ride.proposed_price_da + ride.boost_amount_da;
  const female = ride.female_only;
  // Longue distance entre wilayas → badge « Inter-wilayas » (détection
  // locale partagée avec le client, jamais tarifaire).
  const iw = interWilayaInfo(
    ride.pickup_lat != null && ride.pickup_lng != null
      ? { lat: ride.pickup_lat, lng: ride.pickup_lng }
      : null,
    ride.dest_lat != null && ride.dest_lng != null
      ? { lat: ride.dest_lat, lng: ride.dest_lng }
      : null,
    ride.distance_km
  );

  // Sonnerie + vibration tant que la carte est affichée — même patron que
  // l'offre Express livreur. Respecte la préférence « Sons » du chauffeur
  // (Compte > Préférences) ; la vibration reste (canal séparé).
  const { play, stop, unlock } = useAlertSound("/sounds/new-request.mp3");
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!isChauffeurSoundOn()) return;
      await unlock();
      if (active) await play({ repeat: true, intervalMs: 3000 });
    })();
    vibrate([0, 90, 60, 90]);
    return () => {
      active = false;
      stop();
    };
  }, [play, stop, unlock]);

  return (
    // Positionnée SOUS les coins du bandeau haut (menu à gauche, GPS à droite)
    // pour ne plus les recouvrir : le bandeau occupe ~12→58 px, la carte démarre
    // en dessous (safe-area incluse).
    <div className="absolute inset-x-0 top-[max(64px,calc(env(safe-area-inset-top)+58px))] z-[80] px-3">
      <div className="relative">
        {/* Anneau de notification pulsé (derrière la carte) */}
        <span
          className="dh-ic-ring rounded-sheet-xl pointer-events-none absolute -inset-0.5 border-2"
          style={{ borderColor: VIOLET }}
        />
        <div className="dh-ic-pop relative overflow-hidden rounded-xl border-[1.5px] border-white/60 bg-[var(--d-surface)]/95 shadow-[0_22px_50px_-16px_rgba(20,22,45,.4)] backdrop-blur-xl">
          {/* Barre de temps (12 s) */}
          <span
            className="dh-ic-progress absolute inset-x-0 top-0 z-[1] h-[3px]"
            style={{
              background: `linear-gradient(90deg,#7B7BF0,${VIOLET},#5BE0FF)`,
            }}
          />
          {queueCount > 0 && (
            <div
              className="text-micro absolute -top-[22px] left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-2.5 py-1 font-bold whitespace-nowrap text-white shadow"
              style={{ background: VIOLET }}
            >
              <Bell className="size-2.5" />
              {isAr
                ? `${queueCount} رحلة أخرى في الانتظار`
                : `${queueCount} autre(s) course(s) en attente`}
            </div>
          )}

          {/* En-tête */}
          <div className="flex items-center gap-2 px-3.5 pt-3 pb-1.5">
            <span className="flex items-end gap-[2px]" aria-hidden>
              {[5, 9, 13].map((h, i) => (
                <span
                  key={i}
                  className="dh-wave w-[2.5px] rounded-[2px]"
                  style={{
                    height: h,
                    background: VIOLET,
                    animationDelay: `${i * 0.12}s`,
                  }}
                />
              ))}
            </span>
            <span
              className="drive-sora text-label-lg flex flex-1 items-center gap-1.5 font-extrabold"
              style={{ color: VIOLET }}
            >
              <Bell className="dh-bell size-[15px]" />
              {tr("Nouvelle course", "رحلة جديدة")}
              {/* Longue distance : le chauffeur le sait AVANT d'accepter. */}
              {iw && (
                <span
                  className="text-nano rounded-full px-2 py-0.5 font-extrabold"
                  style={{ background: "rgba(108,43,217,.12)", color: VIOLET }}
                >
                  {tr("Inter-wilayas", "بين الولايات")}
                </span>
              )}
            </span>
            {queueCount > 0 && (
              <span
                className="drive-sora rounded-chip text-micro px-2 py-1 leading-none font-bold"
                style={{ background: "#F1E9FC", color: VIOLET }}
              >
                +{queueCount}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={tr("Fermer", "إغلاق")}
              className="rounded-chip grid size-6 place-items-center text-[var(--d-muted)]"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {/* Corps : client + prix */}
          <div className="px-3.5 pb-2.5">
            <div className="mb-2.5 flex items-center gap-2.5">
              <span
                className="drive-sora grid size-[38px] shrink-0 place-items-center rounded-full text-sm font-extrabold text-white shadow"
                style={{
                  background: female
                    ? `linear-gradient(135deg,#F9A8D4,${ROSE})`
                    : `linear-gradient(135deg,#7B7BF0,${VIOLET})`,
                }}
              >
                {ride.customer_name[0]?.toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="drive-sora text-label-lg flex items-center gap-1.5 font-bold">
                  <span className="truncate">{ride.customer_name}</span>
                  {ride.customer_rating != null && (
                    <span className="text-micro inline-flex items-center gap-0.5 font-bold text-[var(--color-warning-700)]">
                      <Star
                        className="size-2.5 shrink-0"
                        style={{ color: "#E8B53C", fill: "#E8B53C" }}
                      />
                      {String(ride.customer_rating).replace(".", ",")}
                    </span>
                  )}
                  <span className="text-nano-lg ml-auto shrink-0 font-medium text-[var(--d-muted)]">
                    {ago(ride.created_at, isAr)}
                  </span>
                </div>
                <div className="text-micro mt-0.5 flex items-center gap-1 font-semibold text-[var(--d-muted)]">
                  <MapPin className="size-2.5" style={{ color: VIOLET }} />
                  {fmtkm(ride.pickup_dist_km)} {tr("de vous", "منك")}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="drive-sora text-display leading-none font-extrabold">
                  {price}
                </div>
                <div className="text-nano-lg font-semibold text-[var(--d-muted)]">
                  {tr("DA", "دج")}
                </div>
              </div>
            </div>

            {/* Trajet : rail + adresses */}
            <div className="flex gap-2.5 rounded-md bg-[var(--d-soft)] px-3 py-2.5">
              <div className="flex w-3 shrink-0 flex-col items-center pt-1">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: VIOLET }}
                />
                <span className="my-0.5 w-[1.5px] flex-1 bg-[var(--d-line)]" />
                <span className="size-1.5 shrink-0 rounded-full bg-[var(--d-ink)]" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-micro-lg min-w-0 flex-1 truncate font-semibold">
                    {ride.pickup_text ?? tr("Point de départ", "نقطة الانطلاق")}
                  </span>
                  <span className="drive-sora text-nano shrink-0 font-bold text-[var(--d-muted)]">
                    {fmtkm(ride.pickup_dist_km)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-micro-lg min-w-0 flex-1 truncate font-semibold">
                    {ride.dest_text ?? tr("Destination", "الوجهة")}
                    {iw && (
                      <span
                        className="ms-1.5 font-extrabold"
                        style={{ color: VIOLET }}
                      >
                        · {isAr ? iw.labelAr : iw.label}
                      </span>
                    )}
                  </span>
                  <span className="drive-sora text-nano shrink-0 font-bold text-[var(--d-muted)]">
                    {fmtkm(ride.distance_km)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 px-3.5 pb-2.5">
            <button
              type="button"
              onClick={onRefuse}
              disabled={busy}
              className="drive-sora rounded-control-lg text-label flex h-[38px] flex-1 items-center justify-center gap-1.5 border border-[var(--d-line)] bg-[var(--d-surface)] font-bold text-[var(--d-muted)] disabled:opacity-50"
            >
              <X className="size-3.5" />
              {tr("Refuser", "رفض")}
            </button>
            <button
              type="button"
              onClick={onAccept}
              disabled={busy}
              className="drive-shine drive-sora rounded-control-lg text-body-sm flex h-[38px] flex-[1.4] items-center justify-center gap-1.5 font-extrabold text-white disabled:opacity-60"
              style={{ background: GO, boxShadow: `0 6px 16px -5px ${GO}` }}
            >
              <Check className="size-3.5" />
              {tr("Accepter", "قبول")}
            </button>
          </div>
          <button
            type="button"
            onClick={onSeeAll}
            className="drive-sora text-caption flex h-8 w-full items-center justify-center gap-1.5 border-t border-[var(--d-line)] font-bold"
            style={{ color: VIOLET }}
          >
            {isAr
              ? `عرض كل الرحلات (${pendingCount})`
              : `Voir toutes les courses (${pendingCount})`}
            <ArrowRight className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
