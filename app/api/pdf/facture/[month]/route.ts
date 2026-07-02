import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getInvoice } from "@/lib/data/invoices";

export const dynamic = "force-dynamic";

/**
 * FACTURE MENSUELLE COMMERÇANT en VRAI PDF (A4, pdf-lib serveur) — remplace le
 * window.print() qui imprimait la page web. Mêmes données que la page
 * /finances/factures/[month] (getInvoice = source unique, auth session
 * commerçant intégrée : chacun ne génère que SA facture).
 */

const VIOLET = rgb(0.424, 0.169, 0.851); // #6C2BD9
const INK = rgb(0.043, 0.047, 0.07);
const MUTED = rgb(0.42, 0.44, 0.5);
const LINE = rgb(0.9, 0.91, 0.93);
const GO = rgb(0.086, 0.702, 0.392);

function grp(n: number) {
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ month: string }> }
) {
  const { month } = await params;
  const inv = await getInvoice(month);
  if (!inv) {
    return NextResponse.json(
      { error: "Facture introuvable ou non authentifié" },
      { status: 404 }
    );
  }

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 portrait
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
    const tx = opts.right ? x - f.widthOfTextAtSize(s, size) : x;
    page.drawText(s, { x: tx, y, size, font: f, color: opts.color ?? INK });
  };
  const hr = (yy: number, thick = 0.8) =>
    page.drawLine({
      start: { x: M, y: yy },
      end: { x: width - M, y: yy },
      thickness: thick,
      color: LINE,
    });

  // ── En-tête ──
  page.drawRectangle({ x: 0, y: y - 26, width, height: 74, color: VIOLET });
  y -= 2;
  text("COLIGO", M, 20, { bold: true, color: rgb(1, 1, 1) });
  const label = inv.label.charAt(0).toUpperCase() + inv.label.slice(1);
  text(label, width - M, 14, { right: true, bold: true, color: rgb(1, 1, 1) });
  y -= 18;
  text("Relevé mensuel commerçant", M, 11, { color: rgb(1, 1, 1) });
  text(`Édité le ${inv.generatedAtLabel}`, width - M, 9, {
    right: true,
    color: rgb(1, 1, 1),
  });
  y -= 44;

  // ── Commerçant ──
  text("COMMERÇANT", M, 9, { color: MUTED, bold: true });
  y -= 15;
  text(inv.merchant.name, M, 13, { bold: true });
  const addr = [inv.merchant.address, inv.merchant.city]
    .filter(Boolean)
    .join(" · ");
  if (addr) {
    y -= 13;
    text(addr, M, 9.5, { color: MUTED });
  }
  y -= 13;
  text(
    `${inv.ordersCount} commande${inv.ordersCount > 1 ? "s" : ""} sur la période`,
    M,
    9.5,
    { color: MUTED }
  );
  y -= 18;
  hr(y);
  y -= 24;

  // ── Lignes ──
  const row = (
    k: string,
    v: string,
    opts: {
      hint?: string;
      color?: ReturnType<typeof rgb>;
      strong?: boolean;
    } = {}
  ) => {
    text(k, M, 10.5, { color: opts.strong ? INK : MUTED, bold: opts.strong });
    text(v, width - M, opts.strong ? 13 : 10.5, {
      right: true,
      bold: true,
      color: opts.color ?? INK,
    });
    if (opts.hint) {
      y -= 11;
      text(opts.hint, M, 8, { color: MUTED });
    }
    y -= 8;
    hr(y);
    y -= 16;
  };

  row("Encaissé pour vous", `+ ${grp(inv.collectedForYou)} DA`, {
    hint: "Ventes en ligne, QR Coligo Pay et livraisons de tournée",
    color: GO,
  });
  if (inv.commission > 0)
    row("Commission Coligo (produits)", `- ${grp(inv.commission)} DA`);
  if (inv.serviceFees > 0)
    row("Frais de service (ventes espèces)", `- ${grp(inv.serviceFees)} DA`);
  if (inv.tourCommission > 0)
    row("Commission livraison (tournée)", `- ${grp(inv.tourCommission)} DA`);
  if (inv.adjustments !== 0)
    row(
      "Ajustements",
      `${inv.adjustments >= 0 ? "+" : "-"} ${grp(inv.adjustments)} DA`
    );
  if (inv.payouts !== 0)
    row("Versements effectués vers votre compte", `- ${grp(inv.payouts)} DA`);
  row(
    inv.net >= 0 ? "En votre faveur ce mois" : "À régler à Coligo",
    `${grp(inv.net)} DA`,
    { strong: true, color: VIOLET }
  );

  // ── Pied ──
  y -= 14;
  text(
    "Document généré automatiquement par Coligo. Les commissions et frais indiqués",
    M,
    8.5,
    { color: MUTED }
  );
  y -= 11;
  text(
    "sont ceux appliqués au moment de chaque commande (montants figés).",
    M,
    8.5,
    { color: MUTED }
  );
  y -= 11;
  text("Ce relevé ne tient pas lieu de facture fiscale.", M, 8.5, {
    color: MUTED,
  });

  const bytes = await doc.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="facture-coligo-${month}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
