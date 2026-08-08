"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, BellRing, CheckCircle2, Clock } from "lucide-react";
import {
  SERVICE_LABELS,
  zoneMessageFr,
  type ServiceKind,
  type ZoneEval,
  type ZoneRole,
} from "@/lib/zones/service-zones";
import { getZoneAvailability, joinZoneWaitlist } from "@/lib/zones/actions";

/**
 * Notice de disponibilité de zone (TEMPS RÉEL) — réutilisable : inscription
 * commerçant, checkout, etc. Vérifie un point pour un ou plusieurs services et
 * affiche un message clair + bouton « Prévenez-moi » (liste d'attente) pour les
 * services bloqués. Ne s'affiche QUE s'il y a quelque chose à signaler.
 *
 * `onChange(blocked)` permet au parent de gater son bouton de validation.
 */
export function ZoneNotice({
  lat,
  lng,
  services,
  wilayaCode = null,
  commune = null,
  role = "destination",
  onChange,
  className = "",
}: {
  lat: number | null | undefined;
  lng: number | null | undefined;
  services: ServiceKind[];
  wilayaCode?: string | null;
  commune?: string | null;
  role?: ZoneRole;
  onChange?: (blocked: boolean) => void;
  className?: string;
}) {
  const [results, setResults] = useState<
    Partial<Record<ServiceKind, ZoneEval>>
  >({});
  const [joined, setJoined] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const servicesKey = services.join(",");

  useEffect(() => {
    if (lat == null || lng == null) {
      setResults({});
      onChangeRef.current?.(false);
      return;
    }
    let alive = true;
    setJoined(false);
    const t = setTimeout(async () => {
      const r = await getZoneAvailability({
        lat,
        lng,
        wilayaCode,
        commune,
        services,
        role,
      });
      if (!alive) return;
      setResults(r);
      const anyBlocked = Object.values(r).some((e) => e && !e.allowed);
      onChangeRef.current?.(anyBlocked);
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // servicesKey couvre `services` (tableau recréé à chaque render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, wilayaCode, commune, role, servicesKey]);

  const blocked = services.filter((s) => results[s] && !results[s]!.allowed);
  if (!blocked.length) return null;

  const anyComingSoon = blocked.some((s) => results[s]?.coming_soon);

  const join = async () => {
    await Promise.all(
      blocked.map((s) =>
        joinZoneWaitlist({ service: s, lat, lng, wilayaCode, commune })
      )
    );
    setJoined(true);
  };

  return (
    <div
      className={
        "rounded-md border border-amber-200 bg-amber-50 p-3 " + className
      }
    >
      {blocked.map((s) => {
        const e = results[s]!;
        return (
          <p
            key={s}
            className="text-label-lg flex items-start gap-2 font-semibold text-amber-800"
          >
            {e.coming_soon ? (
              <Clock className="mt-0.5 size-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            )}
            <span>
              <span className="font-bold">{SERVICE_LABELS[s]}</span> —{" "}
              {zoneMessageFr(e, role, s)}
            </span>
          </p>
        );
      })}

      {anyComingSoon &&
        (joined ? (
          <p className="text-label mt-2 flex items-center gap-1.5 font-bold text-emerald-700">
            <CheckCircle2 className="size-4" />
            Parfait — on vous prévient dès l&apos;ouverture !
          </p>
        ) : (
          <button
            type="button"
            onClick={join}
            className="text-label mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-3 py-1.5 font-bold text-white"
          >
            <BellRing className="size-3.5" />
            Prévenez-moi
          </button>
        ))}
    </div>
  );
}
