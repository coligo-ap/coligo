"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Clock, X } from "lucide-react";
import { isOpenNow, nextOpening } from "@/lib/merchant/opening-hours";
import {
  computePauseState,
  pauseReasonMessage,
  type MerchantPauseInput,
} from "@/lib/merchant/pause-state";
import type { DayKey, OpeningHours } from "@/lib/types";

const DAY_LABEL: Record<DayKey, string> = {
  mon: "lundi",
  tue: "mardi",
  wed: "mercredi",
  thu: "jeudi",
  fri: "vendredi",
  sat: "samedi",
  sun: "dimanche",
};

/**
 * Bandeau + pop-up « commerce fermé » côté client (façon Deliveroo / Uber Eats).
 *
 * Affiché quand le commerce ne prend pas de commandes IMMÉDIATES — soit parce
 * qu'il est en pause/fermeture (cf. `computePauseState`), soit parce qu'il est
 * hors de ses horaires d'ouverture. On informe + on propose de PROGRAMMER une
 * commande pour plus tard (si le commerçant l'autorise via max_days_ahead) :
 * le client peut alors remplir son panier et choisir un créneau au checkout.
 *
 * Tout est calculé après le montage (heure client) → pas d'écart d'hydratation.
 */
export function MerchantClosedNotice({
  openingHours,
  maxDaysAhead,
  pause,
}: {
  openingHours: OpeningHours;
  maxDaysAhead: number;
  pause: MerchantPauseInput;
}) {
  const [mounted, setMounted] = useState(false);
  const [showModal, setShowModal] = useState(true);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const now = new Date();
  const state = computePauseState(pause, now);
  const openByHours = isOpenNow(openingHours);
  const closed = state.closedNow || !openByHours;
  if (!closed) return null;

  const fmtTime = (d: Date) =>
    d.toLocaleTimeString("fr-DZ", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Algiers",
    });

  // Texte de réouverture : priorité au verrou pause/fermeture, sinon horaires.
  let reopenText = "";
  if (state.reopensAt) {
    const sameDay = state.reopensAt.toDateString() === now.toDateString();
    reopenText = sameDay
      ? `Réouverture vers ${fmtTime(state.reopensAt)}`
      : `Réouverture le ${state.reopensAt.toLocaleDateString("fr-DZ", {
          day: "numeric",
          month: "long",
          timeZone: "Africa/Algiers",
        })}`;
  } else if (!openByHours) {
    const nx = nextOpening(openingHours, now);
    if (nx) reopenText = `Ouvre ${DAY_LABEL[nx.day]} à ${nx.slot.open}`;
  }

  const reason =
    pauseReasonMessage(state) ||
    "Ce commerce est fermé pour le moment et ne prend pas de commandes.";
  const canSchedule = maxDaysAhead > 0;

  return (
    <>
      {/* Bandeau persistant en tête de boutique */}
      <div className="border-warning-200 bg-warning-50 text-warning-900 mb-4 flex items-start gap-3 rounded-[14px] border px-4 py-3">
        <Clock className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">{reason}</p>
          {reopenText && (
            <p className="text-warning-800 mt-0.5">{reopenText}</p>
          )}
          {canSchedule && (
            <p className="text-warning-800 mt-0.5">
              Vous pouvez programmer une commande pour plus tard — choisissez un
              créneau au moment de payer.
            </p>
          )}
        </div>
      </div>

      {/* Pop-up d'entrée (dismissible) */}
      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setShowModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-[20px] bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="bg-warning-50 text-warning-700 flex size-11 items-center justify-center rounded-full">
                <Clock className="size-6" />
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                aria-label="Fermer"
                className="text-subtle hover:bg-surface-2 -mt-1 -mr-1 flex size-8 items-center justify-center rounded-full"
              >
                <X className="size-4" />
              </button>
            </div>
            <h2 className="text-lg font-bold">{reason}</h2>
            {reopenText && (
              <p className="text-muted mt-1 text-sm">{reopenText}</p>
            )}

            <div className="mt-5 flex flex-col gap-2">
              {canSchedule ? (
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="bg-primary-600 hover:bg-primary-700 inline-flex h-11 items-center justify-center gap-2 rounded-[12px] px-4 text-sm font-semibold text-white"
                >
                  <CalendarClock className="size-4" />
                  Programmer une commande
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="bg-primary-600 hover:bg-primary-700 inline-flex h-11 items-center justify-center rounded-[12px] px-4 text-sm font-semibold text-white"
                >
                  J&apos;ai compris
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-muted h-10 text-sm font-medium hover:underline"
              >
                Voir le catalogue
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
