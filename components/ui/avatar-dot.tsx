import { cn } from "@/lib/utils";

/**
 * Pastille avatar : initiale + couleur stable. Utilisée pour les filleuls
 * (parrainage) et les participants du panier partagé. 8 teintes de marque —
 * l'index vient du serveur (member_number % 8) ou d'un hash du nom.
 */
const COLORS = [
  "#6C2BD9", // violet marque
  "#FF2D7A", // rose marque
  "#0EA5E9", // ciel
  "#059669", // émeraude
  "#F59E0B", // ambre
  "#8A4DFF", // violet clair
  "#14B8A6", // sarcelle
  "#F97316", // orange
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function AvatarDot({
  name,
  colorIndex,
  size = "md",
  className,
}: {
  name: string;
  /** Index stable fourni par le serveur ; sinon dérivé du nom. */
  colorIndex?: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const idx =
    (typeof colorIndex === "number" ? colorIndex : hashName(name)) %
    COLORS.length;
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-extrabold text-white select-none",
        size === "sm" ? "size-7 text-xs" : "size-9 text-sm",
        className
      )}
      style={{ backgroundColor: COLORS[idx] }}
    >
      {initial}
    </span>
  );
}
