import { BRAND_GO, BRAND_VIOLET } from "@/components/shared/partner-ui";

/**
 * Animation de marque Coligo des jalons du parcours livreur.
 *
 *  - `sent`     : dossier transmis — une flèche d'envoi se trace dans un disque
 *                 violet, un halo se propage.
 *  - `verified` : compte vérifié — une coche se trace dans un disque vert, halo
 *                 + confettis aux couleurs de la marque.
 *
 * 100 % CSS/SVG : rien à télécharger (identique hors ligne dans l'APK), aucune
 * dépendance, aucun emoji. `prefers-reduced-motion` fige l'illustration sur son
 * état final — le message reste donc toujours lisible.
 */

const CONFETTI = [
  { color: BRAND_VIOLET, x: -70, dx: "-24px", rot: "260deg", delay: 0.15 },
  { color: "#FF2D7A", x: -34, dx: "-8px", rot: "-200deg", delay: 0.32 },
  { color: "#8A4DFF", x: 0, dx: "10px", rot: "180deg", delay: 0.05 },
  { color: BRAND_GO, x: 36, dx: "18px", rot: "-300deg", delay: 0.42 },
  { color: BRAND_VIOLET, x: 68, dx: "30px", rot: "220deg", delay: 0.22 },
  { color: "#FF2D7A", x: 92, dx: "-14px", rot: "-160deg", delay: 0.55 },
];

export function ColigoCelebration({
  variant,
}: {
  variant: "sent" | "verified";
}) {
  const verified = variant === "verified";
  const tone = verified ? BRAND_GO : BRAND_VIOLET;
  const halo = verified ? "rgba(22,179,100,.35)" : "rgba(108,43,217,.35)";

  return (
    <div
      aria-hidden
      className="coligo-anim relative mx-auto grid size-[172px] place-items-center"
    >
      {verified &&
        CONFETTI.map((c, i) => (
          <span
            key={i}
            className="absolute top-2 block h-2.5 w-1.5 rounded-[1px]"
            style={
              {
                left: `calc(50% + ${c.x}px)`,
                background: c.color,
                "--dx": c.dx,
                "--rot": c.rot,
                animation: `coligo-confetti 1.5s ${c.delay}s ease-in both`,
              } as React.CSSProperties
            }
          />
        ))}

      {/* Halos concentriques (deux vagues décalées). */}
      {[0, 0.7].map((d) => (
        <span
          key={d}
          className="absolute size-[120px] rounded-full"
          style={{
            border: `2px solid ${halo}`,
            animation: `coligo-halo 1.8s ${d}s ease-out infinite`,
          }}
        />
      ))}

      {/* Disque + tracé. */}
      <span
        className="relative grid size-[104px] place-items-center rounded-full"
        style={{
          background: tone,
          boxShadow: `0 18px 40px -14px ${tone}`,
          animation: "coligo-pop .55s cubic-bezier(.22,1.2,.36,1) both",
        }}
      >
        <svg
          viewBox="0 0 48 48"
          fill="none"
          className="size-[52px]"
          stroke="#fff"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {verified ? (
            <path
              d="M13 24.5 L21 32 L35 16"
              style={{
                strokeDasharray: 46,
                strokeDashoffset: 46,
                animation: "coligo-draw .5s .45s ease-out forwards",
              }}
            />
          ) : (
            <>
              {/* Flèche d'envoi (papier qui part). */}
              <path
                d="M38 10 L10 22 L21 26 L25 38 Z"
                style={{
                  strokeDasharray: 96,
                  strokeDashoffset: 96,
                  animation: "coligo-draw .7s .35s ease-out forwards",
                }}
              />
              <path
                d="M38 10 L21 26"
                style={{
                  strokeDasharray: 24,
                  strokeDashoffset: 24,
                  animation: "coligo-draw .35s .95s ease-out forwards",
                }}
              />
            </>
          )}
        </svg>
      </span>
    </div>
  );
}
