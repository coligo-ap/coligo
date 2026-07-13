"use client";

// =============================================================================
// IDV — illustrations ANIMÉES du parcours (100 % SVG + CSS, zéro dépendance,
// thème-aware via les tokens --d-*). Chaque étape a sa vignette : scan du
// document (ligne de balayage), selfie (badge qui pope), vérification
// (bouclier qui pulse). Inclure <IdvIllusStyles/> UNE fois par écran.
// =============================================================================

export function IdvIllusStyles() {
  return (
    <style>{`
      @keyframes idv-scanline {
        0%, 12% { transform: translateY(-16px); opacity: 0; }
        20% { opacity: 1; }
        80% { opacity: 1; }
        88%, 100% { transform: translateY(16px); opacity: 0; }
      }
      @keyframes idv-pop {
        0%, 55% { transform: scale(0); opacity: 0; }
        70% { transform: scale(1.15); opacity: 1; }
        80%, 100% { transform: scale(1); opacity: 1; }
      }
      @keyframes idv-pulse {
        0%, 100% { transform: scale(1); opacity: .35; }
        50% { transform: scale(1.12); opacity: 0; }
      }
      @keyframes idv-breathe {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-2px); }
      }
      .idv-il { display: block; }
      .idv-il .scanline { animation: idv-scanline 2.6s ease-in-out infinite; }
      .idv-il .pop { transform-origin: center; animation: idv-pop 2.6s ease-out infinite; }
      .idv-il .ring { transform-origin: center; animation: idv-pulse 2.6s ease-out infinite; }
      .idv-il .breathe { animation: idv-breathe 2.6s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) {
        .idv-il .scanline, .idv-il .pop, .idv-il .ring, .idv-il .breathe {
          animation: none;
        }
        .idv-il .pop { transform: scale(1); opacity: 1; }
      }
    `}</style>
  );
}

const ACCENT = "var(--d-accent, #6C2BD9)";
const SOFT = "var(--d-soft, rgba(108,43,217,.10))";
const LINE = "var(--d-line, rgba(0,0,0,.12))";
const CARD = "var(--d-card, #ffffff)";

/** Étape 1 — carte d'identité balayée par une ligne de scan. */
export function IllusDocScan({ size = 76 }: { size?: number }) {
  return (
    <svg
      className="idv-il"
      width={size}
      height={size}
      viewBox="0 0 76 76"
      fill="none"
      aria-hidden
    >
      <rect x="6" y="14" width="64" height="48" rx="10" fill={SOFT} />
      <g className="breathe">
        <rect
          x="12"
          y="20"
          width="52"
          height="36"
          rx="6"
          fill={CARD}
          stroke={LINE}
        />
        <circle cx="24" cy="34" r="6" fill={SOFT} stroke={ACCENT} />
        <path
          d="M17 46c1.5-4 4-6 7-6s5.5 2 7 6"
          stroke={ACCENT}
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
        />
        <rect x="38" y="28" width="20" height="3" rx="1.5" fill={LINE} />
        <rect x="38" y="35" width="16" height="3" rx="1.5" fill={LINE} />
        <rect x="38" y="42" width="18" height="3" rx="1.5" fill={LINE} />
      </g>
      {/* coins du viseur */}
      <g stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round">
        <path d="M6 24v-6a4 4 0 0 1 4-4h6" />
        <path d="M60 14h6a4 4 0 0 1 4 4v6" />
        <path d="M70 52v6a4 4 0 0 1-4 4h-6" />
        <path d="M16 62h-6a4 4 0 0 1-4-4v-6" />
      </g>
      <rect
        className="scanline"
        x="10"
        y="36"
        width="56"
        height="3"
        rx="1.5"
        fill={ACCENT}
        opacity=".9"
      />
    </svg>
  );
}

/** Étape 2 — selfie dans un cercle, coche qui pope. */
export function IllusSelfie({ size = 76 }: { size?: number }) {
  return (
    <svg
      className="idv-il"
      width={size}
      height={size}
      viewBox="0 0 76 76"
      fill="none"
      aria-hidden
    >
      <circle className="ring" cx="38" cy="38" r="30" fill={SOFT} />
      <circle cx="38" cy="38" r="24" fill={CARD} stroke={LINE} />
      <g className="breathe">
        <circle cx="38" cy="32" r="8" fill={SOFT} stroke={ACCENT} />
        <path
          d="M24 54c2.5-8 8-12 14-12s11.5 4 14 12"
          stroke={ACCENT}
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      </g>
      <g className="pop">
        <circle cx="58" cy="20" r="10" fill={ACCENT} />
        <path
          d="M53.5 20l3 3 6-6"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </g>
    </svg>
  );
}

/** Étape 3 — bouclier de vérification qui pulse. */
export function IllusShield({ size = 76 }: { size?: number }) {
  return (
    <svg
      className="idv-il"
      width={size}
      height={size}
      viewBox="0 0 76 76"
      fill="none"
      aria-hidden
    >
      <circle className="ring" cx="38" cy="38" r="30" fill={SOFT} />
      <g className="breathe">
        <path
          d="M38 12l20 8v16c0 13-8.5 22-20 28-11.5-6-20-15-20-28V20l20-8z"
          fill={CARD}
          stroke={ACCENT}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M28 38l7 7 13-13"
          stroke={ACCENT}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </g>
    </svg>
  );
}
