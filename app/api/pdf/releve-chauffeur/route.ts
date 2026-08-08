import { NextResponse, type NextRequest } from "next/server";
import { PDFDocument, StandardFonts, type rgb } from "pdf-lib";
import { getCurrentChauffeur } from "@/lib/auth/chauffeur";
import { PDF_INK } from "@/lib/pdf/pdf-kit";
import { parseSettlementPeriod } from "@/lib/driver/settlement-data";
import {
  currentMonthPeriod,
  getChauffeurReleve,
} from "@/lib/chauffeur/releve-data";

export const dynamic = "force-dynamic";

/**
 * RELEVÉ CHAUFFEUR en VRAI PDF (A4, pdf-lib serveur) — MÊME période que la
 * page /chauffeur/releve (?month= / ?from=&to=, défaut mois courant), mêmes
 * données (getChauffeurReleve = source unique). Auth : session chauffeur.
 */

// Encre PARTAGÉE avec les autres PDF (lib/pdf/pdf-kit) : mêmes valeurs, une
// seule source — VIOLET et GO viennent des design tokens.
const { VIOLET, INK, MUTED, LINE, GO, WHITE } = PDF_INK;

function grp(n: number) {
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Helvetica (StandardFont) n'encode que le jeu WinAnsi (~Latin-1). Un nom de
 * chauffeur EN ARABE (fréquent en Algérie), un emoji ou une apostrophe
 * typographique font LEVER une exception à pdf-lib → 500 et « le PDF ne se
 * télécharge pas ». On neutralise tout caractère non encodable AVANT de
 * dessiner : le relevé s'imprime toujours (caractères illisibles omis, jamais
 * un crash).
 */
function pdfSafe(s: string): string {
  return (s ?? "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

export async function GET(req: NextRequest) {
  const ch = await getCurrentChauffeur();
  if (!ch) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const period =
    parseSettlementPeriod({
      month: sp.get("month") ?? undefined,
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
    }) ?? currentMonthPeriod();
  const data = await getChauffeurReleve(ch.id, period);

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width } = page.getSize();
  const M = 48;
  let y = 841.89 - M;

  const text = (
    s: string,
    x: number,
    size: number,
    opts: {
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      right?: boolean;
    } = {}
  ) => {
    const f = opts.bold ? bold : font;
    const str = pdfSafe(s);
    const tx = opts.right ? x - f.widthOfTextAtSize(str, size) : x;
    page.drawText(str, { x: tx, y, size, font: f, color: opts.color ?? INK });
  };
  const hr = (yy: number) =>
    page.drawLine({
      start: { x: M, y: yy },
      end: { x: width - M, y: yy },
      thickness: 0.8,
      color: LINE,
    });

  // En-tête
  page.drawRectangle({ x: 0, y: y - 26, width, height: 74, color: VIOLET });
  y -= 2;
  text("COLIGO DRIVE", M, 20, { bold: true, color: WHITE });
  y -= 18;
  text("Relevé chauffeur", M, 11, { color: WHITE });
  y -= 44;

  const today = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Algiers",
  });
  text(ch.full_name, M, 12, { bold: true });
  text(`Édité le ${today}`, width - M, 10, { right: true, color: MUTED });
  y -= 14;
  text(
    `Période : ${data.periodLabel} · ${data.ridesCount} course${data.ridesCount > 1 ? "s" : ""}`,
    M,
    10,
    { color: MUTED }
  );
  y -= 26;

  text("Net chauffeur", M, 12, { bold: true, color: VIOLET });
  y -= 26;
  text(`${grp(data.netDa)} DA`, M, 26, { bold: true });
  y -= 24;
  hr(y);
  y -= 22;

  text("Détail de la période", M, 12, { bold: true });
  y -= 20;
  const row = (
    k: string,
    v: string,
    opts: { color?: ReturnType<typeof rgb>; strong?: boolean } = {}
  ) => {
    text(k, M, 10.5, { color: opts.strong ? INK : MUTED, bold: opts.strong });
    text(v, width - M, opts.strong ? 12 : 10.5, {
      right: true,
      bold: true,
      color: opts.color ?? INK,
    });
    y -= 8;
    hr(y);
    y -= 16;
  };
  row("Revenus bruts (courses)", `+${grp(data.grossDa)} DA`, { color: GO });
  row("Commission Coligo", `-${grp(data.commissionDa)} DA`);
  if (data.subFeesDa > 0)
    row("Abonnements payés sur la période", `${grp(data.subFeesDa)} DA`);
  row("Net chauffeur", `${grp(data.netDa)} DA`, {
    color: VIOLET,
    strong: true,
  });

  y -= 18;
  text(
    "Document généré automatiquement par Coligo. Montants figés au moment de",
    M,
    8.5,
    { color: MUTED }
  );
  y -= 11;
  text("chaque course. Pour toute question : support Coligo.", M, 8.5, {
    color: MUTED,
  });

  const bytes = await doc.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="releve-chauffeur-coligo-${new Date().toISOString().slice(0, 10)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
