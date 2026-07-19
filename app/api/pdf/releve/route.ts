import { NextResponse, type NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getCurrentDriver } from "@/lib/auth/driver";
import {
  getDriverSettlement,
  parseSettlementPeriod,
} from "@/lib/driver/settlement-data";

export const dynamic = "force-dynamic";

/**
 * RELEVÉ LIVREUR en VRAI PDF (A4, généré serveur avec pdf-lib) — plus de
 * window.print() qui « photographiait » l'écran mobile. Le document est servi
 * INLINE (affichage dans le lecteur PDF du navigateur) et téléchargeable tel
 * quel. Auth : session livreur (cookies) + données via getDriverSettlement
 * (même source que la page /driver/releve).
 */

const VIOLET = rgb(0.424, 0.169, 0.851); // #6C2BD9
const INK = rgb(0.043, 0.047, 0.07);
const MUTED = rgb(0.42, 0.44, 0.5);
const LINE = rgb(0.9, 0.91, 0.93);
const GO = rgb(0.086, 0.702, 0.392);

function grp(n: number) {
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Helvetica (StandardFont) n'encode que le jeu WinAnsi (~Latin-1). Un nom de
 * partenaire EN ARABE (fréquent en Algérie), un emoji ou une apostrophe
 * typographique font LEVER une exception à pdf-lib (drawText / widthOfText) →
 * la route renvoyait 500 et « le PDF ne se télécharge pas ». On neutralise donc
 * tout caractère non encodable AVANT de dessiner : le relevé s'imprime toujours
 * (les caractères illisibles pour Helvetica sont simplement omis, jamais un
 * crash). Les guillemets/​tirets typographiques sont ramenés à leur équivalent
 * ASCII pour rester lisibles.
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
  const driver = await getCurrentDriver();
  if (!driver) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  // MÊME période que l'écran (?month= / ?from=&to=), même interprétation.
  const sp = req.nextUrl.searchParams;
  const period = parseSettlementPeriod({
    month: sp.get("month") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });
  const data = await getDriverSettlement(driver.id, period);

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 portrait (points)
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width } = page.getSize();
  const M = 48; // marge
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
    page.drawText(str, {
      x: tx,
      y,
      size,
      font: f,
      color: opts.color ?? INK,
    });
  };
  const hr = (yy: number) =>
    page.drawLine({
      start: { x: M, y: yy },
      end: { x: width - M, y: yy },
      thickness: 0.8,
      color: LINE,
    });

  // ── En-tête ──
  page.drawRectangle({ x: 0, y: y - 26, width, height: 74, color: VIOLET });
  y -= 2;
  text("COLIGO", M, 20, { bold: true, color: rgb(1, 1, 1) });
  y -= 18;
  text("Relevé livreur - règlement", M, 11, { color: rgb(1, 1, 1) });
  y -= 44;

  // ── Identité + période ──
  const today = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Algiers",
  });
  text(driver.full_name, M, 12, { bold: true });
  text(`Édité le ${today}`, width - M, 10, { right: true, color: MUTED });
  y -= 14;
  text(
    `Période : ${data.periodLabel} · ${data.deliveriesCount} course${data.deliveriesCount > 1 ? "s" : ""}`,
    M,
    10,
    { color: MUTED }
  );
  y -= 26;

  // ── Montant clé ──
  const dirLabel =
    data.direction === "reverse"
      ? "À reverser à Coligo"
      : data.direction === "receive"
        ? "À recevoir de Coligo"
        : "Compte soldé";
  text(dirLabel, M, 12, { bold: true, color: VIOLET });
  y -= 26;
  text(`${grp(data.netDa)} DA`, M, 26, { bold: true });
  if (data.dueLabel) {
    y -= 14;
    text(data.dueLabel, M, 9.5, { color: MUTED });
  }
  if (data.method) {
    y -= 13;
    text(
      `Méthode de versement : ${data.method.toUpperCase()}${data.details ? ` · ${data.details}` : ""}`,
      M,
      9.5,
      { color: MUTED }
    );
  }
  y -= 22;
  hr(y);
  y -= 22;

  // ── Détail (réconcilie exactement au solde) ──
  text("Détail de la période", M, 12, { bold: true });
  y -= 20;
  const row = (
    k: string,
    v: string,
    opts: { color?: ReturnType<typeof rgb>; strong?: boolean } = {}
  ) => {
    text(k, M, 10.5, {
      color: opts.strong ? INK : MUTED,
      bold: opts.strong,
    });
    text(v, width - M, opts.strong ? 12 : 10.5, {
      right: true,
      bold: true,
      color: opts.color ?? INK,
    });
    y -= 8;
    hr(y);
    y -= 16;
  };
  row("Gains nets du livreur (à lui)", `+${grp(data.grossDriverDa)} DA`, {
    color: GO,
  });
  row("Commissions commerçants", `${grp(data.commissionDa)} DA`);
  row("Frais de service", `${grp(data.serviceFeeDa)} DA`);
  row(
    `Part Coligo livraison (${data.driverFeeRatePct}%)`,
    `${grp(data.driverFeeDa)} DA`
  );
  if (data.toReceiveDa > 0) {
    row(
      "Livraisons prépayées (dues par Coligo)",
      `+${grp(data.toReceiveDa)} DA`,
      { color: GO }
    );
  }
  row(
    data.direction === "reverse"
      ? "Solde à reverser"
      : data.direction === "receive"
        ? "Solde à recevoir"
        : "Solde",
    `${grp(data.netDa)} DA`,
    { color: VIOLET, strong: true }
  );

  // ── Pied ──
  y -= 18;
  text(
    "Document généré automatiquement par Coligo. Montants issus du grand livre",
    M,
    8.5,
    { color: MUTED }
  );
  y -= 11;
  text(
    "des livraisons (écritures non réglées). Pour toute question : support Coligo.",
    M,
    8.5,
    { color: MUTED }
  );

  const bytes = await doc.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // inline = AFFICHAGE dans le lecteur PDF (téléchargeable depuis celui-ci) ;
      // les WebView Android sans lecteur déclenchent le téléchargement direct.
      "Content-Disposition": `inline; filename="releve-coligo-${new Date().toISOString().slice(0, 10)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
