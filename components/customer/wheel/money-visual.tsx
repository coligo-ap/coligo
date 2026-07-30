"use client";

/**
 * ARGENT ALGÉRIEN VISUEL — le client voit les billets/pièces de son gain au
 * lieu d'un chiffre abstrait. Un montant est DÉCOMPOSÉ en coupures réelles
 * (billets 2000/1000/500/200 DA, pièces 200/100/50/20/10/5 DA) rendues en
 * SVG fidèles aux vraies couleurs (2000 = bleu, 1000 = ocre, 500 = violet,
 * 200 = vert-brun ; pièces bimétalliques argent/laiton).
 *
 * POURQUOI des illustrations et pas des photos : les visuels des billets sont
 * la propriété de la Banque d'Algérie (aucune source libre exploitable) — on
 * reproduit les codes visuels (couleur + valeur + دج), pas les billets.
 */

const NOTE_COLORS: Record<number, { a: string; b: string; ink: string }> = {
  2000: { a: "#2e6f9e", b: "#7fb3d5", ink: "#123a57" }, // bleu
  1000: { a: "#b35f2a", b: "#e0a370", ink: "#5d2c0e" }, // ocre / brun-rouge
  500: { a: "#5b4a9b", b: "#9d8ed1", ink: "#2a2054" }, // violet
  200: { a: "#6c7a3f", b: "#b4bd7e", ink: "#333d17" }, // vert-brun
};

/** Pièces : anneau / centre (bimétal réel : 200,100,50,20,10 ; 5 = acier). */
const COIN_COLORS: Record<number, { ring: string; core: string }> = {
  200: { ring: "#c9a227", core: "#cfd2d6" },
  100: { ring: "#cfd2d6", core: "#c9a227" },
  50: { ring: "#c9a227", core: "#cfd2d6" },
  20: { ring: "#cfd2d6", core: "#7d8b4a" },
  10: { ring: "#c9a227", core: "#cfd2d6" },
  5: { ring: "#d7dade", core: "#d7dade" },
};

const NOTES = [2000, 1000, 500, 200] as const;
const COINS = [200, 100, 50, 20, 10, 5] as const;

export type MoneyPiece = { kind: "note" | "coin"; value: number };

/** Décomposition gloutonne d'un montant en coupures réelles. */
export function decomposeDa(amountDa: number): MoneyPiece[] {
  let rest = Math.max(0, Math.round(amountDa));
  const out: MoneyPiece[] = [];
  for (const v of NOTES) {
    while (rest >= v && out.length < 8) {
      out.push({ kind: "note", value: v });
      rest -= v;
    }
  }
  for (const v of COINS) {
    // Le billet de 200 prime sur la pièce de 200 (déjà consommé ci-dessus).
    if (v === 200) continue;
    while (rest >= v && out.length < 8) {
      out.push({ kind: "coin", value: v });
      rest -= v;
    }
  }
  return out;
}

function Note({ value, size }: { value: number; size: number }) {
  const c = NOTE_COLORS[value] ?? NOTE_COLORS[500];
  const w = size * 1.9;
  const h = size;
  const id = `mn${value}`;
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 76 40"
      aria-hidden
      className="shrink-0 drop-shadow-sm"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c.b} />
          <stop offset="1" stopColor={c.a} />
        </linearGradient>
      </defs>
      <rect
        x="0.8"
        y="0.8"
        width="74.4"
        height="38.4"
        rx="4"
        fill={`url(#${id})`}
        stroke={c.ink}
        strokeOpacity=".35"
        strokeWidth="1"
      />
      {/* filigrane + bande métallique, codes visuels d'un billet */}
      <circle cx="17" cy="20" r="10" fill="#ffffff" fillOpacity=".22" />
      <rect
        x="56"
        y="2"
        width="4"
        height="36"
        fill="#ffffff"
        fillOpacity=".28"
      />
      <text
        x="37"
        y="23"
        textAnchor="middle"
        fontFamily="Sora,system-ui"
        fontWeight="800"
        fontSize="14"
        fill="#ffffff"
        stroke={c.ink}
        strokeOpacity=".25"
        strokeWidth=".4"
      >
        {value}
      </text>
      <text
        x="37"
        y="33"
        textAnchor="middle"
        fontFamily="system-ui"
        fontWeight="700"
        fontSize="6.5"
        fill="#ffffff"
        fillOpacity=".9"
      >
        دينار جزائري
      </text>
    </svg>
  );
}

function Coin({ value, size }: { value: number; size: number }) {
  const c = COIN_COLORS[value] ?? COIN_COLORS[100];
  const s = size;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 40 40"
      aria-hidden
      className="shrink-0 drop-shadow-sm"
    >
      <circle
        cx="20"
        cy="20"
        r="19"
        fill={c.ring}
        stroke="#8a8f96"
        strokeWidth="1"
      />
      <circle
        cx="20"
        cy="20"
        r="12.5"
        fill={c.core}
        stroke="#9aa0a6"
        strokeWidth=".6"
      />
      <text
        x="20"
        y="24"
        textAnchor="middle"
        fontFamily="Sora,system-ui"
        fontWeight="800"
        fontSize="11"
        fill="#3d4147"
      >
        {value}
      </text>
      <text
        x="20"
        y="31.5"
        textAnchor="middle"
        fontFamily="system-ui"
        fontWeight="700"
        fontSize="4.6"
        fill="#3d4147"
        fillOpacity=".85"
      >
        دج
      </text>
    </svg>
  );
}

/**
 * Rangée de coupures pour un montant : jusqu'à 3 visuels superposés façon
 * éventail + « +N » si la décomposition dépasse. `size` = hauteur d'un billet.
 */
export function MoneyVisual({
  amountDa,
  size = 34,
  className,
}: {
  amountDa: number;
  size?: number;
  className?: string;
}) {
  const pieces = decomposeDa(amountDa);
  if (pieces.length === 0) return null;
  const shown = pieces.slice(0, 3);
  const extra = pieces.length - shown.length;
  return (
    <span
      className={`inline-flex items-center ${className ?? ""}`}
      role="img"
      aria-label={`${amountDa} DA`}
    >
      {shown.map((p, i) => (
        <span
          key={i}
          className="inline-flex"
          style={{
            marginInlineStart: i === 0 ? 0 : -size * 0.55,
            transform: `rotate(${(i - (shown.length - 1) / 2) * 7}deg)`,
            zIndex: i,
          }}
        >
          {p.kind === "note" ? (
            <Note value={p.value} size={size} />
          ) : (
            <Coin value={p.value} size={size * 0.92} />
          )}
        </span>
      ))}
      {extra > 0 && (
        <b className="ms-1 text-[11px] font-extrabold opacity-80">+{extra}</b>
      )}
    </span>
  );
}
