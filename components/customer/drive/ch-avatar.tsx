"use client";

import { useState } from "react";
import { VIOLET, ROSE } from "@/components/customer/drive/drive-modals";

/**
 * Avatar chauffeur : photo de visage (selfie signé) si disponible, sinon
 * l'initiale sur le dégradé habituel (rose si conductrice). `background`
 * permet de garder les tons spéciaux (ex. liste d'offres, mode femme).
 */
export function ChAvatar({
  name,
  url,
  size,
  female = false,
  background,
  className = "",
  textClassName = "",
  ringColor = null,
}: {
  name: string;
  url?: string | null;
  size: number;
  female?: boolean;
  background?: string;
  className?: string;
  textClassName?: string;
  /** Couleur du badge de plan (0304) → anneau coloré autour de la photo. */
  ringColor?: string | null;
}) {
  // Photo cassée (URL signée expirée…) → repli initiale.
  const [broken, setBroken] = useState(false);
  const fallbackBg =
    background ??
    (female
      ? `linear-gradient(135deg,#F9A8D4,${ROSE})`
      : `linear-gradient(135deg,#7B7BF0,${VIOLET})`);
  // Anneau façon Uber : fin liseré (fond) + anneau de la couleur du plan.
  const ring = ringColor
    ? `0 0 0 2px var(--d-surface), 0 0 0 4px ${ringColor}`
    : undefined;
  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className={`shrink-0 rounded-full object-cover ${ringColor ? "" : "border border-[var(--d-line)]"} ${className}`}
        style={{ width: size, height: size, boxShadow: ring }}
      />
    );
  }
  return (
    <span
      className={`drive-sora grid shrink-0 place-items-center rounded-full font-extrabold text-white ${textClassName} ${className}`}
      style={{
        width: size,
        height: size,
        background: fallbackBg,
        boxShadow: ring,
      }}
    >
      {name[0]?.toUpperCase() ?? "?"}
    </span>
  );
}
