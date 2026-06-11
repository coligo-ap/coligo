"use client";

import { useEffect, useState } from "react";
import { Car, Loader2 } from "lucide-react";
import { haversineKm } from "@/lib/delivery/distance";
import { DriveMap } from "./drive-map";
import { VIOLET, GO } from "./drive-modals";
import { getShareRide, type ShareRide } from "@/app/t/[token]/actions";

/** Suivi public en direct (position, plaque, note, ETA) — aucun compte requis. */
export function ShareTrackView({ token }: { token: string }) {
  const [ride, setRide] = useState<ShareRide>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const r = await getShareRide(token);
      if (!stop) {
        setRide(r);
        setLoaded(true);
      }
    };
    void poll();
    const id = setInterval(poll, 6000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [token]);

  if (!loaded) {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--d-page)]">
        <Loader2 className="size-6 animate-spin" style={{ color: VIOLET }} />
      </div>
    );
  }
  if (!ride) {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--d-page)] px-6 text-center">
        <p className="text-sm font-semibold text-[var(--d-muted)]">
          Ce lien de suivi n&apos;est plus actif.
        </p>
      </div>
    );
  }

  const carPos =
    ride.ch_lat != null ? { lat: ride.ch_lat, lng: ride.ch_lng! } : null;
  const destPos =
    ride.dest_lat != null ? { lat: ride.dest_lat, lng: ride.dest_lng! } : null;
  const etaMin =
    carPos && destPos
      ? Math.max(1, Math.round(haversineKm(carPos, destPos) * 2.2))
      : null;
  const finished = ride.status === "completed";

  return (
    <div className="drive-screen bg-[var(--d-page)]">
      <DriveMap
        markers={[
          ...(carPos ? [{ id: "car", pos: carPos, kind: "car" as const }] : []),
          ...(destPos
            ? [{ id: "dest", pos: destPos, kind: "pin" as const }]
            : []),
        ]}
        route={carPos && destPos && !finished ? [carPos, destPos] : null}
        padding={{ top: 90, bottom: 260, left: 60, right: 60 }}
      />
      <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[var(--d-surface)] px-4 py-2 text-[13.5px] font-bold whitespace-nowrap shadow-lg">
        <Car className="size-4" style={{ color: VIOLET }} />
        <span className="drive-sora">Coligo Drive · suivi en direct</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 z-10 rounded-t-[26px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-4 pb-[max(20px,env(safe-area-inset-bottom))]">
        <div className="mb-3 flex items-center gap-3">
          <span
            className="drive-sora grid size-[46px] shrink-0 place-items-center rounded-full text-lg font-extrabold text-white"
            style={{ background: `linear-gradient(135deg,#7B7BF0,${VIOLET})` }}
          >
            {ride.ch_name?.[0]?.toUpperCase() ?? "?"}
          </span>
          <span className="min-w-0 flex-1">
            <b className="drive-sora block text-[16px] font-extrabold">
              {ride.ch_name ?? "Chauffeur"}
              {ride.ch_rating != null
                ? ` · ★ ${String(ride.ch_rating).replace(".", ",")}`
                : ""}
            </b>
            <small className="text-[11.5px] text-[var(--d-muted)]">
              {ride.ch_vehicle ?? ""}
            </small>
          </span>
          {ride.ch_plate && (
            <span className="drive-sora drive-plate shrink-0 rounded-[7px] border-2 px-2.5 py-1 text-[12.5px] font-extrabold tracking-[2px]">
              {ride.ch_plate}
            </span>
          )}
        </div>
        <div className="rounded-[14px] bg-[var(--d-soft)] px-4 py-3 text-[13px] font-semibold">
          {finished ? (
            <span style={{ color: GO }}>
              Course terminée — arrivée à destination ✓
            </span>
          ) : (
            <>
              Vers <b>{ride.dest_text ?? "—"}</b>
              {etaMin != null && (
                <span className="text-[var(--d-muted)]">
                  {" "}
                  · arrivée estimée ~{etaMin} min
                </span>
              )}
            </>
          )}
        </div>
        <p className="mt-2 text-center text-[10.5px] text-[var(--d-muted)]">
          Position mise à jour en continu · partagé via Coligo Drive
        </p>
      </div>
    </div>
  );
}
