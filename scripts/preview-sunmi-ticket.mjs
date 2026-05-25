#!/usr/bin/env node
/**
 * Génère un preview ASCII du ticket Sunmi en se basant sur les commandes
 * structurées produites par `buildTicketSunmiCommands()`. Ne tape pas le
 * firmware — c'est une simulation pure pour valider le layout avant de
 * gaspiller du papier.
 *
 *   node scripts/preview-sunmi-ticket.mjs
 *
 * Reproduit la même logique d'alignement / padding que le firmware Sunmi
 * sur 32 colonnes (58 mm). Pour les textBoldStrong (double-width), on
 * indique avec des `**` et on multiplie la largeur visuelle.
 */

// Simulation simplifiée — réplique inline pour ne pas dépendre du build
// Next.js. Si le builder évolue, ce script peut diverger ; il sert avant
// tout de check de design.

const COLS = 48; // Sunmi V3 80 mm = 48 chars / ligne en taille normale
const heavy = "=".repeat(COLS);
const dotted = "-".repeat(COLS);

function pad(text, align) {
  if (text.length >= COLS) return text.slice(0, COLS);
  const space = COLS - text.length;
  if (align === "center") {
    const l = Math.floor(space / 2);
    return " ".repeat(l) + text + " ".repeat(space - l);
  }
  if (align === "right") return " ".repeat(space) + text;
  return text;
}

function shortId(id) {
  return id.slice(0, 6).toUpperCase();
}
function formatDA(n) {
  return n.toString() + " DA";
}
function fmtTime() {
  return "12:45";
}
function fmtSub() {
  return "25/05/26 18:00";
}

const order = {
  id: "TESTABC",
  merchant: "Boulangerie Demo",
  customer: "Yacine Boudjellal",
  phone: "+213 555 12 34 56",
  pickupCode: "428173",
  pickupTime: "12:45",
  notes: "Sans oignons s'il vous plaît",
  total: 1750,
  serviceFee: 0,
  cashback: 0,
  cash: true,
  items: [
    {
      cat: "Boulangerie",
      list: [{ qty: 2, name: "Baguette tradition", total: 100 }],
    },
    {
      cat: "Viennoiseries",
      list: [{ qty: 4, name: "Croissant beurre", total: 400 }],
    },
    {
      cat: "Sandwichs",
      list: [{ qty: 1, name: "Sandwich poulet maison", total: 1250 }],
    },
  ],
};

const lines = [];
const heavySep = () => lines.push(heavy);
const lightSep = () => lines.push(dotted);

heavySep();
lines.push(pad("*" + order.merchant + "*", "center"));
heavySep();
lines.push(pad("[" + "RETRAIT" + "]", "center"));
heavySep();
lines.push(pad("CODE DE RETRAIT", "center"));
lines.push(pad("**" + order.pickupCode.slice(-4) + "**", "center"));
heavySep();
lines.push(pad("RETRAIT A", "center"));
lines.push(pad("**" + order.pickupTime + "**", "center"));
heavySep();
if (order.notes) {
  lines.push(pad("*NOTE CLIENT :*", "left"));
  lines.push(order.notes);
  heavySep();
}
lines.push(pad("*ARTICLES*", "center"));
lightSep();
const qtyW = 3,
  priceW = 8,
  nameW = COLS - qtyW - priceW - 2;
for (let gi = 0; gi < order.items.length; gi++) {
  const g = order.items[gi];
  lines.push(pad("*" + g.cat.toUpperCase() + "*", "left"));
  for (const it of g.list) {
    const qty = (it.qty + "x").padEnd(qtyW + 1);
    const name = it.name.slice(0, nameW).padEnd(nameW + 1);
    const price = formatDA(it.total).padStart(priceW);
    lines.push(qty + name + price);
  }
  if (gi < order.items.length - 1) lightSep();
}
heavySep();
lines.push(pad("**TOTAL " + formatDA(order.total) + "**", "center"));
if (order.cash) {
  lines.push(
    pad("*** A ENCAISSER : " + formatDA(order.total) + " ***", "center")
  );
}
heavySep();
const labW = Math.floor(COLS * 0.28);
const valW = COLS - labW;
lines.push("Soumis".padEnd(labW) + fmtSub().padStart(valW));
lines.push("Client".padEnd(labW) + order.customer.padStart(valW));
lines.push("Tel".padEnd(labW) + order.phone.padStart(valW));
heavySep();
lines.push(pad("Scanner pour valider :", "center"));
lines.push(pad("[QR " + order.pickupCode + "]", "center"));
heavySep();
lines.push(pad("Coligo  " + fmtSub(), "center"));

console.log("\n┌" + "─".repeat(COLS) + "┐");
for (const l of lines) console.log("│" + l.padEnd(COLS).slice(0, COLS) + "│");
console.log("└" + "─".repeat(COLS) + "┘\n");
console.log(
  "Légende preview : *gras*, **gras double-width**, [bandeau inversé], [QR ...]"
);
