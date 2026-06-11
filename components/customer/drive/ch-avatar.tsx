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
}: {
  name: string;
  url?: string | null;
  size: number;
  female?: boolean;
  background?: string;
  className?: string;
  textClassName?: string;
}) {
  // Photo cassée (URL signée expirée…) → repli initiale.
  const [broken, setBroken] = useState(false);
  const fallbackBg =
    background ??
    (female
      ? `linear-gradient(135deg,#F9A8D4,${ROSE})`
      : `linear-gradient(135deg,#7B7BF0,${VIOLET})`);
  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className={`shrink-0 rounded-full border border-[var(--d-line)] object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={`drive-sora grid shrink-0 place-items-center rounded-full font-extrabold text-white ${textClassName} ${className}`}
      style={{ width: size, height: size, background: fallbackBg }}
    >
      {name[0]?.toUpperCase() ?? "?"}
    </span>
  );
}
