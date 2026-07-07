import { NextResponse } from "next/server";
import { PDFDocument, PDFPage, StandardFonts, rgb } from "pdf-lib";
import {
  getPayoutStatement,
  type PayoutStatement,
} from "@/lib/data/payout-statements";
import { APP_CONFIG } from "@/lib/config/app-config";
import {
  PDF_INK,
  PDF_DAY_FMT as DAY_FMT,
  type Fonts,
  fit,
  grp,
  makeText,
  safe,
  signed,
} from "@/lib/pdf/pdf-kit";

export const dynamic = "force-dynamic";

/**
 * FACTURE DE VERSEMENT commerçant en VRAI PDF (pdf-lib serveur, jamais de
 * window.print) :
 *   - défaut        → facture RÉSUMÉ A4 portrait (CA, commissions, frais,
 *                     remboursements, net versé + réconciliation de solde) ;
 *   - ?detail=1     → facture DÉTAILLÉE A4 paysage, une ligne par commande.
 * Auth : session commerçant — getPayoutStatement (RLS) ne renvoie que SES
 * versements payés.
 */

const { VIOLET, INK, MUTED, LINE, GO, RED, SOFT } = PDF_INK;

/* ───────────────────────────── FACTURE RÉSUMÉ ───────────────────────────── */

function buildSummaryPage(doc: PDFDocument, st: PayoutStatement, fonts: Fonts) {
  const page = doc.addPage([595.28, 841.89]); // A4 portrait
  const { width } = page.getSize();
  const M = 48;
  const text = makeText(page, fonts);
  let y = 841.89 - M;

  // ── Bandeau ──
  page.drawRectangle({ x: 0, y: y - 30, width, height: 78, color: VIOLET });
  text("COLIGO", M, y - 2, 20, { bold: true, color: rgb(1, 1, 1) });
  text(`Facture n° ${st.invoiceNumber}`, width - M, y + 2, 13, {
    right: true,
    bold: true,
    color: rgb(1, 1, 1),
  });
  text("Facture de versement", M, y - 20, 11, { color: rgb(1, 1, 1) });
  text(
    `Réf. ${st.reference} · éditée le ${st.generatedAtLabel}`,
    width - M,
    y - 16,
    9,
    { right: true, color: rgb(1, 1, 1) }
  );
  y -= 66;

  // ── Coordonnées (émetteur / destinataire) ──
  const colR = width / 2 + 10;
  text("COLIGO (PLATEFORME)", M, y, 8.5, { color: MUTED, bold: true });
  text("COMMERÇANT", colR, y, 8.5, { color: MUTED, bold: true });
  y -= 14;
  text(APP_CONFIG.name, M, y, 12, { bold: true });
  text(
    fit(safe(st.merchant.name), fonts.bold, 12, width - M - colR),
    colR,
    y,
    12,
    {
      bold: true,
    }
  );
  y -= 13;
  text(`${APP_CONFIG.domains.customer} · Algérie`, M, y, 9.5, { color: MUTED });
  // Set : commune et ville sont souvent identiques (ex. « Akbou · Akbou »).
  const addr = [
    ...new Set(
      [st.merchant.address, st.merchant.commune, st.merchant.city].filter(
        Boolean
      )
    ),
  ].join(" · ");
  text(fit(safe(addr), fonts.font, 9.5, width - M - colR), colR, y, 9.5, {
    color: MUTED,
  });
  y -= 12;
  text(APP_CONFIG.contact.supportEmail, M, y, 9.5, { color: MUTED });
  if (st.merchant.phone) {
    text(safe(st.merchant.phone), colR, y, 9.5, { color: MUTED });
  }
  y -= 22;

  // ── Cartouche période / versement ──
  page.drawRectangle({
    x: M,
    y: y - 34,
    width: width - 2 * M,
    height: 46,
    color: SOFT,
  });
  text("PÉRIODE COUVERTE", M + 12, y - 4, 8, { color: MUTED, bold: true });
  text(`Activité ${st.periodLabel}`, M + 12, y - 17, 10.5, { bold: true });
  text(
    `${st.ordersCount} commande${st.ordersCount > 1 ? "s" : ""} · versé le ${DAY_FMT.format(new Date(st.periodTo))} · ${st.payout.method.toUpperCase()}`,
    M + 12,
    y - 29,
    9,
    { color: MUTED }
  );
  y -= 58;

  // ── Lignes ──
  const hr = (yy: number) =>
    page.drawLine({
      start: { x: M, y: yy },
      end: { x: width - M, y: yy },
      thickness: 0.8,
      color: LINE,
    });
  const row = (
    k: string,
    v: string,
    opts: { hint?: string; color?: ReturnType<typeof rgb> } = {}
  ) => {
    text(k, M, y, 10.5, { color: MUTED });
    text(v, width - M, y, 10.5, {
      right: true,
      bold: true,
      color: opts.color ?? INK,
    });
    if (opts.hint) {
      y -= 11;
      text(opts.hint, M, y, 8, { color: MUTED });
    }
    y -= 8;
    hr(y);
    y -= 16;
  };

  const t = st.totals;
  row("Chiffre d'affaires (produits)", `+ ${grp(t.salesDa)} DA`, {
    color: GO,
    hint: "Total facturé aux clients sur les commandes de la période, remises déduites",
  });
  if (t.deliveryFeesDa > 0)
    row(
      "Frais de livraison (payés par les clients)",
      `+ ${grp(t.deliveryFeesDa)} DA`,
      {
        color: GO,
      }
    );
  if (t.commissionDa !== 0)
    row("Commissions Coligo", `- ${grp(t.commissionDa)} DA`, { color: RED });
  if (t.serviceFeesDa !== 0)
    row("Frais de service", `- ${grp(t.serviceFeesDa)} DA`, { color: RED });
  if (t.adjustmentsDa !== 0)
    row("Remboursements & ajustements", signed(t.adjustmentsDa), {
      color: t.adjustmentsDa >= 0 ? GO : RED,
    });
  if (t.taxesDa !== 0) row("Taxes", `- ${grp(t.taxesDa)} DA`, { color: RED });

  // ── Net versé ──
  y -= 4;
  page.drawRectangle({
    x: M,
    y: y - 24,
    width: width - 2 * M,
    height: 40,
    color: VIOLET,
  });
  text("MONTANT NET VERSÉ", M + 12, y - 8, 10, {
    bold: true,
    color: rgb(1, 1, 1),
  });
  text(`${grp(t.paidDa)} DA`, width - M - 12, y - 10, 16, {
    right: true,
    bold: true,
    color: rgb(1, 1, 1),
  });
  y -= 46;

  // ── Réconciliation de solde ──
  text("RÉCONCILIATION DE VOTRE SOLDE COLIGO PAY", M, y, 8.5, {
    color: MUTED,
    bold: true,
  });
  y -= 16;
  const mini = (k: string, v: string, strong = false) => {
    text(k, M, y, 9.5, { color: strong ? INK : MUTED, bold: strong });
    text(v, width - M, y, 9.5, { right: true, bold: true });
    y -= 14;
  };
  mini("Solde reporté (début de période)", signed(t.openingBalanceDa));
  mini("Activité nette de la période", signed(t.netActivityDa));
  mini("Versement effectué", `- ${grp(t.paidDa)} DA`);
  hr(y + 6);
  y -= 4;
  mini("Solde après versement", signed(t.closingBalanceDa), true);

  // ── Pied ──
  y -= 14;
  const foot = [
    "Le montant versé est prélevé sur votre solde Coligo Pay (report des périodes précédentes",
    "inclus) — la réconciliation ci-dessus en donne le détail exact. Les commissions et frais",
    "indiqués sont ceux appliqués au moment de chaque commande (montants figés).",
    "Document généré automatiquement par Coligo — il ne tient pas lieu de facture fiscale.",
  ];
  for (const l of foot) {
    text(l, M, y, 8.5, { color: MUTED });
    y -= 11;
  }
}

/* ──────────────────────────── FACTURE DÉTAILLÉE ──────────────────────────── */

const COLS: {
  key: string;
  label: string;
  w: number;
  align: "left" | "right";
}[] = [
  { key: "num", label: "Commande", w: 78, align: "left" },
  { key: "date", label: "Date", w: 58, align: "left" },
  { key: "client", label: "Client", w: 128, align: "left" },
  { key: "pay", label: "Paiement", w: 58, align: "left" },
  { key: "prod", label: "Produits", w: 78, align: "right" },
  { key: "liv", label: "Livraison", w: 68, align: "right" },
  { key: "com", label: "Commission", w: 78, align: "right" },
  { key: "fee", label: "Frais serv.", w: 68, align: "right" },
  { key: "ref", label: "Rembours.", w: 68, align: "right" },
  { key: "net", label: "Net reversé", w: 79, align: "right" },
];

function buildDetailPages(doc: PDFDocument, st: PayoutStatement, fonts: Fonts) {
  const W = 841.89;
  const H = 595.28; // A4 paysage
  const M = 40;
  const ROW_H = 14;

  const colX: number[] = [];
  let acc = M;
  for (const c of COLS) {
    colX.push(acc);
    acc += c.w;
  }

  let page!: PDFPage;
  let text!: ReturnType<typeof makeText>;
  let y = 0;

  const header = (first: boolean) => {
    page = doc.addPage([W, H]);
    text = makeText(page, fonts);
    y = H - M;
    page.drawRectangle({
      x: 0,
      y: y - 18,
      width: W,
      height: 58,
      color: VIOLET,
    });
    text("COLIGO", M, y - 6, 14, { bold: true, color: rgb(1, 1, 1) });
    text(
      `Facture détaillée n° ${st.invoiceNumber} · ${st.periodLabel}`,
      W - M,
      y - 6,
      10,
      { right: true, bold: true, color: rgb(1, 1, 1) }
    );
    y -= 34;
    if (first) {
      text(
        `${safe(st.merchant.name)} — ${st.ordersCount} commande${st.ordersCount > 1 ? "s" : ""} · versé le ${DAY_FMT.format(new Date(st.periodTo))} · réf. ${st.reference}`,
        M,
        y,
        9,
        { color: MUTED }
      );
      y -= 16;
    } else {
      y -= 6;
    }
    // En-tête de colonnes.
    for (let i = 0; i < COLS.length; i++) {
      const c = COLS[i];
      text(c.label, c.align === "right" ? colX[i] + c.w - 4 : colX[i], y, 8, {
        bold: true,
        color: MUTED,
        right: c.align === "right",
      });
    }
    y -= 5;
    page.drawLine({
      start: { x: M, y },
      end: { x: W - M, y },
      thickness: 0.8,
      color: LINE,
    });
    y -= ROW_H;
  };

  header(true);

  const cell = (
    i: number,
    s: string,
    opts: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}
  ) => {
    const c = COLS[i];
    const max = c.w - 8;
    const f = opts.bold ? fonts.bold : fonts.font;
    text(
      fit(s, f, 8, max),
      c.align === "right" ? colX[i] + c.w - 4 : colX[i],
      y,
      8,
      {
        right: c.align === "right",
        bold: opts.bold,
        color: opts.color,
      }
    );
  };

  for (const o of st.orders) {
    if (y < M + 40) header(false);
    cell(0, safe(o.orderNumber), { bold: true });
    cell(1, DAY_FMT.format(new Date(o.createdAt)), { color: MUTED });
    cell(2, safe(o.customerName), { color: MUTED });
    cell(3, o.paymentMethod === "cash" ? "Espèces" : "En ligne", {
      color: MUTED,
    });
    cell(4, o.productsDa ? `${grp(o.productsDa)}` : "—");
    cell(5, o.deliveryFeeDa ? `${grp(o.deliveryFeeDa)}` : "—");
    cell(6, o.commissionDa ? `- ${grp(o.commissionDa)}` : "—", { color: RED });
    cell(7, o.serviceFeeDa ? `- ${grp(o.serviceFeeDa)}` : "—", { color: RED });
    cell(8, o.refundsDa ? signed(o.refundsDa).replace(" DA", "") : "—", {
      color: o.refundsDa >= 0 ? GO : RED,
    });
    cell(9, signed(o.netDa).replace(" DA", ""), {
      bold: true,
      color: o.netDa >= 0 ? GO : RED,
    });
    y -= ROW_H;
  }

  // Totaux (sur la dernière page ; saute de page si plus de place).
  if (y < M + 56) header(false);
  page.drawLine({
    start: { x: M, y: y + 9 },
    end: { x: W - M, y: y + 9 },
    thickness: 0.8,
    color: LINE,
  });
  const t = st.totals;
  cell(2, "TOTAUX (montants en DA)", { bold: true, color: MUTED });
  cell(4, grp(t.salesDa), { bold: true });
  cell(5, grp(t.deliveryFeesDa), { bold: true });
  cell(6, `- ${grp(t.commissionDa)}`, { bold: true, color: RED });
  cell(7, `- ${grp(t.serviceFeesDa)}`, { bold: true, color: RED });
  cell(8, signed(t.adjustmentsDa).replace(" DA", ""), { bold: true });
  y -= ROW_H + 6;
  text(
    `Montant net versé : ${grp(t.paidDa)} DA (prélevé sur votre solde Coligo Pay, report des périodes précédentes inclus)`,
    M,
    y,
    9.5,
    { bold: true, color: VIOLET }
  );
  y -= 14;
  text(
    "Document généré automatiquement par Coligo — il ne tient pas lieu de facture fiscale.",
    M,
    y,
    8,
    { color: MUTED }
  );
}

/* ────────────────────────────────── ROUTE ────────────────────────────────── */

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const st = await getPayoutStatement(id);
  if (!st) {
    return NextResponse.json(
      { error: "Versement introuvable, non payé ou non authentifié" },
      { status: 404 }
    );
  }

  const detail = new URL(req.url).searchParams.get("detail") === "1";
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    font: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  if (detail) buildDetailPages(doc, st, fonts);
  else buildSummaryPage(doc, st, fonts);

  const bytes = await doc.save();
  const name = `facture-versement-${st.invoiceNumber}${detail ? "-detail" : ""}.pdf`;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
