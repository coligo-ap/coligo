"use client";

import { ArrowRight, Bell, Check, MapPin, X } from "lucide-react";
import { GO, ROSE, VIOLET } from "@/components/customer/drive/drive-modals";
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

  return (
    // Positionnée SOUS les coins du bandeau haut (menu à gauche, GPS à droite)
    // pour ne plus les recouvrir : le bandeau occupe ~12→58 px, la carte démarre
    // en dessous (safe-area incluse).
    <div className="absolute inset-x-0 top-[max(64px,calc(env(safe-area-inset-top)+58px))] z-[80] px-3">
      <div className="relative">
        {/* Anneau de notification pulsé (derrière la carte) */}
        <span
          className="dh-ic-ring pointer-events-none absolute -inset-0.5 rounded-[22px] border-2"
          style={{ borderColor: VIOLET }}
        />
        <div className="dh-ic-pop relative overflow-hidden rounded-[20px] border-[1.5px] border-white/60 bg-[var(--d-surface)]/95 shadow-[0_22px_50px_-16px_rgba(20,22,45,.4)] backdrop-blur-xl">
          {/* Barre de temps (12 s) */}
          <span
            className="dh-ic-progress absolute inset-x-0 top-0 z-[1] h-[3px]"
            style={{
              background: `linear-gradient(90deg,#7B7BF0,${VIOLET},#5BE0FF)`,
            }}
          />
          {queueCount > 0 && (
            <div
              className="absolute -top-[22px] left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold whitespace-nowrap text-white shadow"
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
              className="drive-sora flex flex-1 items-center gap-1.5 text-[12.5px] font-extrabold"
              style={{ color: VIOLET }}
            >
              <Bell className="dh-bell size-[15px]" />
              {tr("Nouvelle course", "رحلة جديدة")}
            </span>
            {queueCount > 0 && (
              <span
                className="drive-sora rounded-[9px] px-2 py-1 text-[10px] leading-none font-bold"
                style={{ background: "#F1E9FC", color: VIOLET }}
              >
                +{queueCount}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={tr("Fermer", "إغلاق")}
              className="grid size-6 place-items-center rounded-[9px] text-[var(--d-muted)]"
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
                <div className="drive-sora flex items-center gap-1.5 text-[12.5px] font-bold">
                  <span className="truncate">{ride.customer_name}</span>
                  {ride.customer_rating != null && (
                    <span className="text-[10px] text-[#E8B53C]">
                      ★ {String(ride.customer_rating).replace(".", ",")}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[9.5px] font-medium text-[var(--d-muted)]">
                    {ago(ride.created_at, isAr)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-[var(--d-muted)]">
                  <MapPin className="size-2.5" style={{ color: VIOLET }} />
                  {fmtkm(ride.pickup_dist_km)} {tr("de vous", "منك")}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="drive-sora text-[22px] leading-none font-extrabold">
                  {price}
                </div>
                <div className="text-[9.5px] font-semibold text-[var(--d-muted)]">
                  {tr("DA", "دج")}
                </div>
              </div>
            </div>

            {/* Trajet : rail + adresses */}
            <div className="flex gap-2.5 rounded-[12px] bg-[var(--d-soft)] px-3 py-2.5">
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
                  <span className="min-w-0 flex-1 truncate text-[10.5px] font-semibold">
                    {ride.pickup_text ?? tr("Point de départ", "نقطة الانطلاق")}
                  </span>
                  <span className="drive-sora shrink-0 text-[9px] font-bold text-[var(--d-muted)]">
                    {fmtkm(ride.pickup_dist_km)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[10.5px] font-semibold">
                    {ride.dest_text ?? tr("Destination", "الوجهة")}
                  </span>
                  <span className="drive-sora shrink-0 text-[9px] font-bold text-[var(--d-muted)]">
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
              className="drive-sora flex h-[38px] flex-1 items-center justify-center gap-1.5 rounded-[11px] border border-[var(--d-line)] bg-[var(--d-surface)] text-[12px] font-bold text-[var(--d-muted)] disabled:opacity-50"
            >
              <X className="size-3.5" />
              {tr("Refuser", "رفض")}
            </button>
            <button
              type="button"
              onClick={onAccept}
              disabled={busy}
              className="drive-shine drive-sora flex h-[38px] flex-[1.4] items-center justify-center gap-1.5 rounded-[11px] text-[13px] font-extrabold text-white disabled:opacity-60"
              style={{ background: GO, boxShadow: `0 6px 16px -5px ${GO}` }}
            >
              <Check className="size-3.5" />
              {tr("Accepter", "قبول")}
            </button>
          </div>
          <button
            type="button"
            onClick={onSeeAll}
            className="drive-sora flex h-8 w-full items-center justify-center gap-1.5 border-t border-[var(--d-line)] text-[11px] font-bold"
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
