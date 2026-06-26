"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff } from "lucide-react";
import {
  getRidePhoneShared,
  setRidePhoneShared,
} from "@/app/(customer)/drive/actions";

/**
 * Toggle « Afficher mon numéro au chauffeur ». Par défaut le numéro est MASQUÉ
 * (le chauffeur joint le client via Coligo Call). Le client peut l'afficher /
 * le re-masquer à tout moment pendant la course — le gating est SERVEUR
 * (set_ride_phone_shared), donc le vrai numéro n'atteint le chauffeur que si
 * partagé, et disparaît instantanément si re-masqué (Realtime côté chauffeur).
 */
export function RidePhoneShareToggle({ rideId }: { rideId: string }) {
  const t = useTranslations("drive.enroute");
  const [shared, setShared] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    getRidePhoneShared(rideId).then((v) => {
      if (alive) setShared(v);
    });
    return () => {
      alive = false;
    };
  }, [rideId]);

  function toggle() {
    const next = !shared;
    setShared(next); // optimiste
    startTransition(async () => {
      const res = await setRidePhoneShared(rideId, next);
      if (!res.ok) setShared(!next); // rollback si refus serveur
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={shared}
      className="mt-2 flex w-full items-center gap-3 rounded-[14px] border-[1.5px] border-[var(--d-line)] px-3.5 py-2.5 text-start disabled:opacity-60"
    >
      <span
        className="grid size-8 shrink-0 place-items-center rounded-full"
        style={{ background: "var(--d-soft)" }}
      >
        {shared ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold">{t("shareNumber")}</span>
        <span className="block text-[11px] leading-snug text-[var(--d-muted)]">
          {shared ? t("shareNumberOnHint") : t("shareNumberOffHint")}
        </span>
      </span>
      {/* Interrupteur visuel (position gérée en `left` — robuste WebView Sunmi). */}
      <span
        className="relative h-[24px] w-[42px] shrink-0 rounded-full transition-colors"
        style={{
          background: shared
            ? "var(--d-accent-strong, #6C2BD9)"
            : "var(--d-line)",
        }}
      >
        <span
          className="absolute top-[3px] size-[18px] rounded-full bg-white transition-all"
          style={{ left: shared ? "21px" : "3px" }}
        />
      </span>
    </button>
  );
}
