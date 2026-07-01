"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ArrowRight, CalendarDays, Loader2, Package, Play } from "lucide-react";
import {
  BRAND_VIOLET,
  PartnerEmptyState,
  PartnerInlineError,
  PartnerProgress,
  SORA,
} from "@/components/shared/partner-ui";
import { startTour } from "@/app/(driver)/driver/m/[mdId]/tours/actions";

type SlotItem = {
  id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  max_orders: number;
  pendingCount: number;
  myTourId: string | null;
};

/**
 * Créneaux de tournée (style maquette livreur) : carte par créneau — date en
 * chip, plage horaire en Sora, jauge commandes/capacité, CTA violet. La
 * LOGIQUE est inchangée (startTour → redirection vers l'exécution) ; l'erreur
 * s'affiche INLINE sous le bouton concerné (règle produit, plus de toast).
 */
export function TourSlotsList({
  merchantDriverId,
  slots,
}: {
  merchantDriverId: string;
  slots: SlotItem[];
}) {
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [pending, start] = useTransition();
  // Créneau en cours de démarrage + erreur inline par créneau.
  const [startingId, setStartingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (slots.length === 0) {
    return (
      <PartnerEmptyState
        icon={<CalendarDays className="size-5" />}
        title={tr("Aucun créneau ouvert", "لا توجد فترات مفتوحة")}
        text={tr(
          "Le commerçant n'a pas encore ouvert de créneau de tournée. Repasse plus tard.",
          "لم يفتح التاجر أي فترة جولة بعد. عُد لاحقاً."
        )}
      />
    );
  }

  const onStart = (slotId: string) => {
    setStartingId(slotId);
    setErrors((e) => ({ ...e, [slotId]: "" }));
    start(async () => {
      const r = await startTour(merchantDriverId, slotId);
      if (r.error) {
        setErrors((e) => ({ ...e, [slotId]: r.error! }));
        setStartingId(null);
        return;
      }
      if (r.tourId) {
        router.push(`/driver/m/${merchantDriverId}/tours/${r.tourId}`);
      }
    });
  };

  return (
    <ul className="space-y-3">
      {slots.map((s) => {
        const date = new Date(s.slot_date);
        const busy = pending && startingId === s.id;
        const full = s.pendingCount >= s.max_orders;
        return (
          <li
            key={s.id}
            className="space-y-3 rounded-[18px] border border-[var(--d-line)] bg-[var(--d-surface)] p-4"
          >
            <div className="flex items-center gap-3">
              {/* Chip date (jour + numéro) */}
              <span
                className="flex size-12 shrink-0 flex-col items-center justify-center rounded-[14px] bg-[var(--d-soft)] leading-none"
                style={{ color: "var(--d-ink)" }}
              >
                <span className="text-[10px] font-bold text-[var(--d-muted)] uppercase">
                  {date.toLocaleDateString(isAr ? "ar-DZ" : "fr-FR", {
                    weekday: "short",
                    timeZone: "Africa/Algiers",
                  })}
                </span>
                <span
                  className="mt-0.5 text-[18px] font-extrabold"
                  style={{ fontFamily: SORA }}
                >
                  {date.toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    timeZone: "Africa/Algiers",
                  })}
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className="text-[17px] font-extrabold tracking-[-0.3px] text-[var(--d-ink)] tabular-nums"
                  style={{ fontFamily: SORA }}
                >
                  {s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[12px] font-medium text-[var(--d-muted)] tabular-nums">
                  <Package className="size-3.5" />
                  {isAr
                    ? `${s.pendingCount} طلب للتوصيل`
                    : `${s.pendingCount} commande${s.pendingCount > 1 ? "s" : ""} à livrer`}
                  {" · "}
                  {tr("capacité", "السعة")} {s.max_orders}
                </p>
              </div>
            </div>

            {/* Jauge remplissage du créneau */}
            <PartnerProgress
              value={s.pendingCount}
              max={s.max_orders}
              tone={full ? "#c2790a" : BRAND_VIOLET}
            />

            {s.myTourId ? (
              <Link
                href={`/driver/m/${merchantDriverId}/tours/${s.myTourId}`}
                className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[16px] text-[15px] font-bold text-white active:scale-[0.99]"
                style={{
                  fontFamily: SORA,
                  background: BRAND_VIOLET,
                  boxShadow: "0 14px 28px -12px rgba(108,43,217,.6)",
                }}
              >
                {tr("Continuer la tournée", "متابعة الجولة")}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Link>
            ) : (
              <button
                type="button"
                disabled={pending || s.pendingCount === 0}
                onClick={() => onStart(s.id)}
                className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[16px] text-[15px] font-bold text-white transition-opacity active:scale-[0.99] disabled:opacity-50"
                style={{
                  fontFamily: SORA,
                  background: BRAND_VIOLET,
                  boxShadow: "0 14px 28px -12px rgba(108,43,217,.6)",
                }}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                {s.pendingCount === 0
                  ? tr("Aucune commande à livrer", "لا توجد طلبات")
                  : tr("Démarrer la tournée", "بدء الجولة")}
              </button>
            )}
            {errors[s.id] ? (
              <PartnerInlineError>{errors[s.id]}</PartnerInlineError>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
