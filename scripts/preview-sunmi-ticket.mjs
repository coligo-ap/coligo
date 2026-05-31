#!/usr/bin/env node
/**
 * Preview ASCII du ticket Sunmi — simulation pure (ne tape pas le firmware)
 * pour valider la mise en page avant de gaspiller du papier.
 *
 *   node scripts/preview-sunmi-ticket.mjs
 *
 * Reproduit la logique d'alignement / padding du firmware Sunmi à la laize
 * RÉELLE du terminal commerçant : rouleau 50 mm → 384 dots → **32 colonnes**
 * en police par défaut (cf. migration 0062 + `build-ticket-sunmi.ts`).
 *
 * Conventions de rendu :
 *   - *gras*               → texte emphase (ESC E/G), tout le corps l'est ;
 *   - **gras double-width** → textBoldStrong (ESC ! ), budget colonnes / 2 ;
 *   - [QR ...]             → printQRCode (référence publique uniquement).
 *
 * IMPORTANT : le PIN de retrait n'est JAMAIS imprimé (anti-fraude). Le ticket
 * met en avant le numéro de commande public (#A042) + son QR.
 */

const COLS = 32; // Sunmi V3, rouleau 50 mm = 32 car. / ligne en taille normale
const solid = "=".repeat(COLS);
const dotted = "-".repeat(COLS);

function pad(text, align = "left") {
  if (text.length >= COLS) return text.slice(0, COLS);
  const space = COLS - text.length;
  if (align === "center") {
    const l = Math.floor(space / 2);
    return " ".repeat(l) + text + " ".repeat(space - l);
  }
  if (align === "right") return " ".repeat(space) + text;
  return text;
}

/** label gauche / valeur droite pré-paddé sur `cols` (cf. lineLR du builder). */
function lineLR(left, right, cols = COLS) {
  const r = right.length > cols ? right.slice(0, cols) : right;
  const maxL = cols - r.length - 1;
  const l =
    left.length > Math.max(0, maxL) ? left.slice(0, Math.max(0, maxL)) : left;
  const gap = Math.max(1, cols - l.length - r.length);
  return l + " ".repeat(gap) + r;
}

function formatDA(n) {
  return n.toString() + " DA";
}

// Jeu d'essai (1 commande RETRAIT cash, 3 catégories, 1 note).
const order = {
  merchant: "Boulangerie Demo",
  locality: "Bejaia - Akbou",
  orderNumber: "A042",
  mode: "RETRAIT",
  pickupTime: "12:45",
  customer: "Yacine Boudjellal",
  phone: "+213 555 12 34 56",
  orderedAt: "25/05 18:00",
  notes: "Sans oignons",
  subtotal: 1750,
  serviceFee: 0,
  total: 1750,
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
      list: [{ qty: 1, name: "Sandwich poulet maison artisanal", total: 1250 }],
    },
  ],
};

// Lignes d'un article : "2x nom .......... prix", nom long → wrap indenté.
function itemLines(qty, name, price) {
  const prefix = `${qty}x `;
  const indent = " ".repeat(prefix.length);
  const firstW = Math.max(1, COLS - prefix.length - price.length - 1);
  const restW = Math.max(1, COLS - prefix.length);
  const words = name.split(/\s+/);
  const wrapped = [];
  let cur = "";
  for (const w of words) {
    const width = wrapped.length === 0 ? firstW : restW;
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += " " + w;
    else {
      wrapped.push(cur);
      cur = w;
    }
  }
  if (cur) wrapped.push(cur);
  const out = [lineLR(prefix + wrapped[0], price)];
  for (let i = 1; i < wrapped.length; i++) out.push(indent + wrapped[i]);
  return out;
}

const lines = [];
const half = Math.floor(COLS / 2);

// 1. En-tête
lines.push(pad("*" + order.merchant + "*", "center"));
lines.push(pad(order.locality, "center"));
// 2. Mode (gras entre deux lignes pleines — pas d'aplat noir, cf. firmware)
lines.push(solid);
lines.push(pad("*" + order.mode + "*", "center"));
lines.push(solid);
// 3. Numéro de commande énorme (référence publique)
lines.push(pad("**#" + order.orderNumber + "**", "center"));
// 4. Heure de retrait
lines.push(pad(order.mode + " A", "center"));
lines.push(pad("**" + order.pickupTime + "**", "center"));
lines.push(dotted);
// 5. Méta client
lines.push(lineLR("Client", order.customer));
lines.push(lineLR("Tel", order.phone));
lines.push(lineLR("Commande le", order.orderedAt));
lines.push(dotted);
// 6. Articles par catégorie
for (const g of order.items) {
  const count = g.list.reduce((s, it) => s + it.qty, 0);
  lines.push("*" + g.cat.toUpperCase() + " (" + count + ")*");
  for (const it of g.list) {
    for (const l of itemLines(it.qty, it.name, formatDA(it.total)))
      lines.push(l);
  }
}
if (order.notes) lines.push("-> " + order.notes);
lines.push(dotted);
// 7. Récap + TOTAL
if (order.serviceFee > 0 || order.subtotal !== order.total) {
  lines.push(lineLR("Sous-total", formatDA(order.subtotal)));
}
if (order.serviceFee > 0)
  lines.push(lineLR("Frais livraison", formatDA(order.serviceFee)));
lines.push(
  pad("**" + lineLR("TOTAL", formatDA(order.total), half) + "**", "center")
);
// 8. Bloc paiement encadré
lines.push(solid);
lines.push(
  pad(
    order.cash
      ? "*A ENCAISSER : " + formatDA(order.total) + "*"
      : "*[OK] PAYE EN LIGNE*",
    "center"
  )
);
lines.push(solid);
lines.push(dotted);
// 9. QR de référence (jamais le PIN)
lines.push(solid);
lines.push(pad("REFERENCE COMMANDE", "center"));
lines.push(pad("[QR " + order.orderNumber + "]", "center"));
lines.push(pad("*#" + order.orderNumber + "*", "center"));
lines.push(solid);
// 10. Merci + footer
lines.push(pad("*Merci et a bientot !*", "center"));
lines.push(pad("- - - - - - - - - - -", "center"));
lines.push(pad("Commande via Coligo", "center"));
lines.push(pad("Imprime le " + order.orderedAt, "center"));

console.log("\n+" + "-".repeat(COLS) + "+ (50 mm / 32 col.)");
for (const l of lines) console.log("|" + l.padEnd(COLS).slice(0, COLS) + "|");
console.log("+" + "-".repeat(COLS) + "+\n");
console.log(
  "Legende : *gras*, **gras double-width**, [QR ...] — PIN jamais imprime."
);
