"use client";

/**
 * Rendu du ticket de commande en BITMAP via <canvas>, pour l'imprimante
 * intégrée Sunmi (InnerPrinter, AIDL `jiuiv5`).
 *
 * POURQUOI un bitmap et pas les commandes texte ?
 * ------------------------------------------------
 * Sur le firmware de l'imprimante intégrée 50 mm (jiuiv5), testé en réel :
 *   - `setFontSize()` lève « -5 Illegal parameter » → AUCUN contrôle de taille ;
 *   - les bits taille de `ESC !` sont ignorés (tout sort en taille par défaut) ;
 *   - `printText` n'imprime fiablement qu'avec `\n`, et tout `sendRAWData`
 *     superflu fait avancer le papier (tickets à rallonge, ~1 m observé).
 * → IMPOSSIBLE d'avoir des tailles/polices variées ni un interligne maîtrisé
 *   par l'API texte. La SEULE voie fiable est de dessiner le ticket en image
 *   et d'appeler `printBitmap` : l'imprimante imprime les pixels tels quels,
 *   net, compact, avec la typo qu'on veut.
 *
 * On dessine à la largeur PHYSIQUE de la tête (384 dots en 50/58 mm, 576 en
 * 80 mm), on binarise (N&B strict, indispensable en thermique), et on renvoie
 * un PNG base64 (sans préfixe) prêt pour `printSunmiBitmap`.
 *
 * Mise en page calée sur `build-ticket-sunmi.ts` / `ticket-format.ts` (mêmes
 * libellés métier) — style Deliveroo : en-tête, bandeau inversé mode+paiement,
 * #commande géant, articles par catégorie (sans prix), récap, total, bloc
 * infos, QR (référence publique), pied dépendant du mode.
 */

import type { TicketOrder } from "@/lib/ticket/build-ticket-html";
import type { PrintWidth } from "@/lib/types";
import { qrMatrix } from "@/lib/ticket/qr-svg";
import {
  deriveTicketMeta,
  formatDA,
  formatOrderClock,
  formatTime,
  groupByCategory,
  groupCount,
  orderRef,
  totalUnits,
} from "@/lib/ticket/ticket-format";

export type RenderTicketCanvasOptions = {
  width: PrintWidth;
  appName?: string;
  copyLabel?: string;
};

/** Largeur imprimable en dots selon la laize (tête 8 dots/mm). */
function dotsForWidth(width: PrintWidth): number {
  return width === 80 ? 576 : 384;
}

/**
 * Dessine le ticket et renvoie le PNG base64 (SANS préfixe data:) + dimensions.
 * Retourne `null` hors navigateur ou si le canvas est indisponible.
 */
export async function renderTicketCanvasBase64(
  order: TicketOrder,
  opts: RenderTicketCanvasOptions
): Promise<{ base64: string; widthDots: number; heightDots: number } | null> {
  if (typeof document === "undefined") return null;

  const W = dotsForWidth(opts.width);
  const S = W / 384; // facteur d'échelle (1 en 50/58 mm, 1.5 en 80 mm)
  const PAD = Math.round(14 * S);
  const SANS = "sans-serif";
  const f = (px: number, bold = false) =>
    `${bold ? "bold " : ""}${Math.round(px * S)}px ${SANS}`;

  const meta = deriveTicketMeta(order);

  // QR de la référence publique (jamais le PIN). Échec → pas de QR (non bloquant).
  let qr: boolean[][] | null = null;
  try {
    qr = await qrMatrix(orderRef(order), { margin: 1 });
  } catch {
    qr = null;
  }

  // Canvas de travail (hauteur généreuse, recadré ensuite).
  const work = document.createElement("canvas");
  work.width = W;
  work.height = 4000;
  const ctx = work.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, 4000);
  ctx.fillStyle = "#000";

  let y = Math.round(10 * S);

  const textAt = (
    txt: string,
    font: string,
    align: "left" | "center" | "right",
    yTop: number
  ) => {
    ctx.font = font;
    ctx.textBaseline = "top";
    const w = ctx.measureText(txt).width;
    let x = PAD;
    if (align === "center") x = (W - w) / 2;
    else if (align === "right") x = W - PAD - w;
    ctx.fillText(txt, x, yTop);
  };

  const lineLR = (l: string, r: string, font: string, yTop: number) => {
    ctx.font = font;
    ctx.textBaseline = "top";
    ctx.fillText(l, PAD, yTop);
    ctx.fillText(r, W - PAD - ctx.measureText(r).width, yTop);
  };

  /** Dessine `txt` en passant à la ligne ≤ largeur utile ; renvoie le y final. */
  const wrapDraw = (txt: string, font: string, yTop: number, lh: number) => {
    ctx.font = font;
    ctx.textBaseline = "top";
    const words = txt.split(/\s+/).filter(Boolean);
    let line = "";
    let yy = yTop;
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (ctx.measureText(t).width > W - 2 * PAD && line) {
        ctx.fillText(line, PAD, yy);
        yy += lh;
        line = w;
      } else {
        line = t;
      }
    }
    if (line) {
      ctx.fillText(line, PAD, yy);
      yy += lh;
    }
    return yy;
  };

  const divider = (yTop: number) => {
    ctx.strokeStyle = "#000";
    ctx.lineWidth = Math.max(1, Math.round(S));
    ctx.setLineDash([Math.round(4 * S), Math.round(3 * S)]);
    ctx.beginPath();
    ctx.moveTo(PAD, yTop + Math.round(4 * S));
    ctx.lineTo(W - PAD, yTop + Math.round(4 * S));
    ctx.stroke();
    ctx.setLineDash([]);
    return yTop + Math.round(12 * S);
  };

  // === COPIE k/N ===
  if (opts.copyLabel) {
    textAt(opts.copyLabel, f(15), "center", y);
    y += Math.round(20 * S);
  }

  // === 1. EN-TÊTE ===
  textAt(opts.appName ?? "Coligo", f(30, true), "center", y);
  y += Math.round(34 * S);
  textAt(order.merchant_name, f(20), "center", y);
  y += Math.round(28 * S);

  // === 2. BANDEAU INVERSÉ mode + paiement ===
  const bh = Math.round(34 * S);
  ctx.fillStyle = "#000";
  ctx.fillRect(PAD, y, W - 2 * PAD, bh);
  ctx.fillStyle = "#fff";
  textAt(meta.bannerText, f(22, true), "center", y + Math.round(6 * S));
  ctx.fillStyle = "#000";
  y += bh + Math.round(12 * S);

  // === 3. NUMÉRO DE COMMANDE GÉANT (gauche) ===
  textAt(`#${orderRef(order)}`, f(60, true), "left", y);
  y += Math.round(64 * S);

  // === 4. Heure de retrait / livraison ===
  textAt(
    `${meta.timeLineLabel} : ${formatTime(order.pickup_slot_at)}`,
    f(22, true),
    "left",
    y
  );
  y += Math.round(28 * S);
  y = divider(y);

  // === 5. PRÉCISIONS (note client) ===
  const note = order.notes && order.notes !== "seed" ? order.notes : null;
  if (note) {
    textAt("Precisions particulieres", f(21, true), "left", y);
    y += Math.round(26 * S);
    y = wrapDraw(note, f(21), y, Math.round(26 * S));
    y = divider(y);
  }

  // === 6. ARTICLES par catégorie (sans prix) ===
  const groups = groupByCategory(order.items);
  if (groups.length === 0) {
    textAt("(aucun article)", f(21), "left", y);
    y += Math.round(26 * S);
  } else {
    for (const g of groups) {
      textAt(
        `${g.title.toUpperCase()} (${groupCount(g.items)})`,
        f(21, true),
        "left",
        y
      );
      y += Math.round(26 * S);
      for (const it of g.items) {
        const qty = String(it.quantity).replace(/\.0+$/, "") + "x";
        y = wrapDraw(
          `${qty} ${it.product_name}`,
          f(23, true),
          y,
          Math.round(27 * S)
        );
      }
    }
  }
  y = divider(y);

  // === 7. RÉCAP ===
  const recap = (l: string, r: string) => {
    lineLR(l, r, f(21), y);
    y += Math.round(26 * S);
  };
  recap("Nombre de produits", String(totalUnits(order.items)));
  recap("Sous-total", formatDA(meta.subtotalDa));
  if (order.service_fee_da > 0)
    recap(meta.feeLabel, formatDA(order.service_fee_da));
  if (meta.discountDa > 0) {
    const pct =
      meta.subtotalDa > 0
        ? Math.round((meta.discountDa / meta.subtotalDa) * 100)
        : 0;
    recap(
      pct > 0 ? `Reduction -${pct}%` : "Reduction",
      `-${formatDA(meta.discountDa)}`
    );
  }
  if (order.cashback_da > 0)
    recap("Cashback", `-${formatDA(order.cashback_da)}`);

  // === 8. TOTAL / À ENCAISSER ===
  lineLR(meta.totalLabel, formatDA(order.total_da), f(27, true), y);
  y += Math.round(32 * S);
  if (meta.isCash) {
    textAt(`paiement en especes ${meta.handoffWord}`, f(17), "center", y);
    y += Math.round(24 * S);
  }
  y = divider(y);

  // === 9. BLOC INFOS ===
  const info = (label: string, value: string) =>
    (y = wrapDraw(`${label} : ${value}`, f(20), y, Math.round(25 * S)));
  info("Heure commande", formatOrderClock(order.created_at));
  info("Client", order.customer_name);
  info(
    "Telephone",
    meta.isDelivery
      ? (order.delivery_phone ?? order.customer_phone)
      : order.customer_phone
  );
  if (meta.isDelivery && order.delivery_address)
    info("Adresse", order.delivery_address);
  if (meta.isDelivery && order.delivery_note)
    info("Acces", order.delivery_note);
  y = divider(y);

  // === 10. QR (référence publique) ===
  if (qr) {
    const mods = qr.length;
    const ms = Math.max(2, Math.floor((150 * S) / mods));
    const qpx = ms * mods;
    const qx = Math.floor((W - qpx) / 2);
    for (let r = 0; r < mods; r++) {
      for (let c = 0; c < mods; c++) {
        if (qr[r][c]) ctx.fillRect(qx + c * ms, y + r * ms, ms, ms);
      }
    }
    y += qpx + Math.round(8 * S);
  }

  // === 11. PIED ===
  y = wrapDraw(meta.footerText, f(19, true), y, Math.round(24 * S));
  y += Math.round(6 * S);

  // === Recadrage à la hauteur réelle + binarisation N&B ===
  const H = Math.min(4000, Math.ceil(y));
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const octx = out.getContext("2d");
  if (!octx) return null;
  octx.drawImage(work, 0, 0, W, H, 0, 0, W, H);
  const img = octx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = gray >= 160 ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);

  const base64 = out
    .toDataURL("image/png")
    .replace(/^data:image\/png;base64,/, "");
  return { base64, widthDots: W, heightDots: H };
}
