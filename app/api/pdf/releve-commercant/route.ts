import { NextResponse, type NextRequest } from "next/server";
import { PDFDocument, PDFPage, StandardFonts } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";
import { WALLET_ENTRY_META, type WalletEntryType } from "@/lib/types";
import {
  PDF_INK,
  PDF_DAY_FMT,
  type Fonts,
  fit,
  grp,
  makeText,
  safe,
  signed,
} from "@/lib/pdf/pdf-kit";

export const dynamic = "force-dynamic";

/**
 * RELEVÉ DES OPÉRATIONS commerçant en VRAI PDF (A4 portrait, pdf-lib serveur) —
 * pendant PDF de l'export CSV `/finances/export` : mêmes bornes de période
 * [from, to) ISO fournies par le filtre de la page Finances. Auth : session
 * commerçant (RLS scope ses écritures).
 */

const { VIOLET, INK, MUTED, LINE, GO, RED, WHITE } = PDF_INK;

const LONG_DATE = new Intl.DateTimeFormat("fr-DZ", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Africa/Algiers",
});

type Row = {
  created_at: string;
  type: WalletEntryType;
  amount_da: number;
  note: string | null;
  orders: {
    order_number: string | null;
    payment_method: "cash" | "online";
  } | null;
};

const COLS: { label: string; w: number; align: "left" | "right" }[] = [
  { label: "Date", w: 55, align: "left" },
  { label: "Opération", w: 120, align: "left" },
  { label: "Commande", w: 62, align: "left" },
  { label: "Paiement", w: 52, align: "left" },
  { label: "Montant (DA)", w: 80, align: "right" },
  { label: "Note", w: 130, align: "left" },
];

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  if (
    !from ||
    !to ||
    Number.isNaN(Date.parse(from)) ||
    Number.isNaN(Date.parse(to))
  ) {
    return NextResponse.json({ error: "Période invalide" }, { status: 400 });
  }

  const [{ data: merchant }, { data: entries }] = await Promise.all([
    supabase
      .from("merchants")
      .select("name")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("wallet_entries")
      .select(
        "created_at, type, amount_da, note, orders ( order_number, payment_method )"
      )
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: false }),
  ]);
  const rows = (entries ?? []) as unknown as Row[];
  const netDa = rows.reduce((s, r) => s + r.amount_da, 0);

  // Libellé humain de la période : `to` est exclusif (minuit du lendemain).
  const periodLabel = `du ${LONG_DATE.format(new Date(from))} au ${LONG_DATE.format(new Date(Date.parse(to) - 1))}`;

  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    font: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  const W = 595.28;
  const H = 841.89; // A4 portrait
  const M = 48;
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
      y: y - 22,
      width: W,
      height: 70,
      color: VIOLET,
    });
    text("COLIGO", M, y - 4, 16, { bold: true, color: WHITE });
    text("Relevé des opérations", W - M, y - 2, 10, {
      right: true,
      bold: true,
      color: WHITE,
    });
    text(periodLabel, W - M, y - 15, 8.5, { right: true, color: WHITE });
    y -= 40;
    if (first) {
      text(safe(merchant?.name), M, y, 11, { bold: true });
      text(
        `Édité le ${LONG_DATE.format(new Date())} · ${rows.length} opération${rows.length > 1 ? "s" : ""}`,
        W - M,
        y,
        8.5,
        { right: true, color: MUTED }
      );
      y -= 18;
    } else {
      y -= 4;
    }
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
    opts: { bold?: boolean; color?: typeof INK } = {}
  ) => {
    const c = COLS[i];
    const f = opts.bold ? fonts.bold : fonts.font;
    text(
      fit(s, f, 8, c.w - 8),
      c.align === "right" ? colX[i] + c.w - 4 : colX[i],
      y,
      8,
      { right: c.align === "right", bold: opts.bold, color: opts.color }
    );
  };

  if (rows.length === 0) {
    text("Aucune opération sur la période.", M, y, 9.5, { color: MUTED });
    y -= ROW_H;
  }
  for (const r of rows) {
    if (y < M + 40) header(false);
    cell(0, PDF_DAY_FMT.format(new Date(r.created_at)), { color: MUTED });
    cell(1, WALLET_ENTRY_META[r.type]?.label ?? r.type, { bold: true });
    cell(2, r.orders?.order_number ?? "—", { color: MUTED });
    cell(
      3,
      r.orders
        ? r.orders.payment_method === "cash"
          ? "Espèces"
          : "En ligne"
        : "—",
      { color: MUTED }
    );
    cell(4, signed(r.amount_da).replace(" DA", ""), {
      bold: true,
      color: r.amount_da >= 0 ? GO : RED,
    });
    cell(5, safe(r.note), { color: MUTED });
    y -= ROW_H;
  }

  // ── Total net de la période ──
  if (y < M + 44) header(false);
  page.drawLine({
    start: { x: M, y: y + 9 },
    end: { x: W - M, y: y + 9 },
    thickness: 0.8,
    color: LINE,
  });
  text("NET DE LA PÉRIODE", M, y - 2, 9.5, { bold: true });
  text(signed(netDa), W - M, y - 2, 11, {
    right: true,
    bold: true,
    color: VIOLET,
  });
  y -= 20;
  text(
    "Document généré automatiquement par Coligo — il ne tient pas lieu de facture fiscale.",
    M,
    y,
    8,
    { color: MUTED }
  );

  const bytes = await doc.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="releve-coligo-${from.slice(0, 10)}-${to.slice(0, 10)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
