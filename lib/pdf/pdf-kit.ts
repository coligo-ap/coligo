import type { PDFFont, PDFPage } from "pdf-lib";
import { rgb } from "pdf-lib";

// =============================================================================
// Briques communes des PDF Coligo (pdf-lib serveur — jamais window.print).
// Partagées par /api/pdf/versement et /api/pdf/releve-commercant.
// =============================================================================

export const PDF_INK = {
  VIOLET: rgb(0.424, 0.169, 0.851), // #6C2BD9
  INK: rgb(0.043, 0.047, 0.07),
  MUTED: rgb(0.42, 0.44, 0.5),
  LINE: rgb(0.9, 0.91, 0.93),
  GO: rgb(0.086, 0.702, 0.392),
  RED: rgb(0.86, 0.21, 0.27),
  SOFT: rgb(0.965, 0.955, 0.99),
  WHITE: rgb(1, 1, 1),
};

/** Milliers groupés à l'espace (formatDA manuel — pas d'Intl côté PDF). */
export function grp(n: number): string {
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function signed(n: number): string {
  return `${n < 0 ? "-" : "+"} ${grp(n)} DA`;
}

/** Garde uniquement les caractères encodables WinAnsi (Helvetica standard) —
 *  les noms clients/commerces peuvent être en arabe, pdf-lib jetterait. */
export function safe(s: string | null | undefined): string {
  const cleaned = (s ?? "")
    .replace(/[^\x20-\x7E\xA0-\xFFŒœ–—‘’€]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "—";
}

/** « JJ/MM/AA » en fuseau Alger (déterministe). */
export const PDF_DAY_FMT = new Intl.DateTimeFormat("fr-DZ", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  timeZone: "Africa/Algiers",
});

export type Fonts = { font: PDFFont; bold: PDFFont };

/** Traceur de texte lié à une page : gère gras / couleur / alignement droit. */
export function makeText(page: PDFPage, fonts: Fonts) {
  return (
    s: string,
    x: number,
    y: number,
    size: number,
    opts: {
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      right?: boolean;
    } = {}
  ) => {
    const f = opts.bold ? fonts.bold : fonts.font;
    const tx = opts.right ? x - f.widthOfTextAtSize(s, size) : x;
    page.drawText(s, {
      x: tx,
      y,
      size,
      font: f,
      color: opts.color ?? PDF_INK.INK,
    });
  };
}

/** Tronque une chaîne pour tenir dans `max` points à la taille donnée. */
export function fit(s: string, f: PDFFont, size: number, max: number): string {
  if (f.widthOfTextAtSize(s, size) <= max) return s;
  let out = s;
  while (out.length > 1 && f.widthOfTextAtSize(`${out}…`, size) > max) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}
