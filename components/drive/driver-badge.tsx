"use client";

import type { DriverBadge } from "@/lib/drive/driver-badge";

/**
 * Pastille de badge chauffeur (dégradé + emoji + libellé). Affichée sur le
 * profil chauffeur ET côté client (offres) pour valoriser la qualité de service.
 *
 * - `size="sm"` : compacte (cartes d'offres, listes).
 * - `size="md"` : profil (avec l'accroche valorisante).
 */
export function DriverBadgePill({
  badge,
  size = "sm",
  withTitle = false,
}: {
  badge: DriverBadge;
  size?: "sm" | "md";
  withTitle?: boolean;
}) {
  const md = size === "md";
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full font-extrabold shadow-sm " +
        (md ? "px-2.5 py-1 text-[11px]" : "px-2 py-[3px] text-[9.5px]")
      }
      style={{ background: badge.gradient, color: badge.text }}
      title={badge.title}
    >
      <span className={md ? "text-[12px]" : "text-[10px]"}>{badge.emoji}</span>
      {badge.label}
      {withTitle && (
        <span className="font-semibold opacity-80">· {badge.title}</span>
      )}
    </span>
  );
}
