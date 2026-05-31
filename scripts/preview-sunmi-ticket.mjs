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
 * Mise en page calée sur la maquette cible style Deliveroo
 * (`apercu-ticket-deliveroo.html`) :
 *   - *gras*               → texte emphase (ESC E/G), tout le corps l'est ;
 *   - **gras double-width** → textBoldStrong (ESC ! ), budget colonnes / 2 ;
 *   - [INVERSE]            → bandeau vidéo inverse (GS B), mode + paiement.
 *
 * IMPORTANT : le PIN de retrait n'est JAMAIS imprimé (anti-fraude). Le ticket
 * met en avant le numéro de commande public (#A042). On rend DEUX exemples
 * (RETRAIT cash et LIVRAISON payée) pour valider les deux mises en page.
 */

const COLS = 32; // Sunmi V3, rouleau 50 mm = 32 car. / ligne en taille normale
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

/** Wrap greedy sur `width` colonnes (cf. wrapWords du builder). */
function wrap(text, width = COLS) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function formatDA(n) {
  return n.toString() + " DA";
}

// Lignes d'un article (SANS prix) : "2x nom", nom long → wrap indenté.
function itemLines(qty, name) {
  const prefix = `${qty}x `;
  const indent = " ".repeat(prefix.length);
  const w = Math.max(1, COLS - prefix.length);
  const wrapped = wrap(name, w);
  const out = ["*" + prefix + wrapped[0] + "*"];
  for (let i = 1; i < wrapped.length; i++)
    out.push("*" + indent + wrapped[i] + "*");
  return out;
}

function render(order) {
  const lines = [];
  const isDelivery = order.mode === "LIVRAISON";
  const totalUnits = order.items.reduce(
    (s, g) => s + g.list.reduce((a, it) => a + it.qty, 0),
    0
  );
  const banner = `${order.mode} - ${order.cash ? "CASH" : "PAYE"}`;
  const timeLabel = isDelivery ? "Livrer pour" : "Retrait pour";
  const totalLabel = order.cash ? "A ENCAISSER" : "Total";
  const footer = isDelivery
    ? "Code remis par le client au livreur (non imprime)"
    : "Merci de votre confiance";

  // 1. Logo + boutique
  lines.push(pad("*Coligo*", "center"));
  lines.push(pad(order.merchant, "center"));
  // 2. Bandeau inversé mode + paiement
  lines.push(pad("[ " + banner + " ]", "center"));
  // 3. Numéro de commande énorme, aligné à gauche
  lines.push("**#" + order.orderNumber + "**");
  // 4. Heure
  lines.push("*" + timeLabel + " : " + order.time + "*");
  lines.push(dotted);
  // 5. Précisions particulières (si note)
  if (order.notes) {
    lines.push("*Precisions particulieres*");
    for (const l of wrap(order.notes)) lines.push(l);
    lines.push(dotted);
  }
  // 6. Articles par catégorie (sans prix)
  for (const g of order.items) {
    const count = g.list.reduce((s, it) => s + it.qty, 0);
    lines.push("*" + g.cat.toUpperCase() + " (" + count + ")*");
    for (const it of g.list)
      for (const l of itemLines(it.qty, it.name)) lines.push(l);
  }
  lines.push(dotted);
  // 7. Récap + TOTAL
  lines.push(lineLR("Nombre de produits", String(totalUnits)));
  lines.push(lineLR("Sous-total", formatDA(order.subtotal)));
  if (order.fee > 0) {
    lines.push(
      lineLR(
        isDelivery ? "Frais de livraison" : "Frais de service",
        formatDA(order.fee)
      )
    );
  }
  // (gras sur le ticket réel ; pas de marqueur ici pour montrer les 32 col. exactes)
  lines.push(lineLR(totalLabel, formatDA(order.total)));
  if (order.cash) {
    lines.push(
      pad(
        "paiement en especes " + (isDelivery ? "a la livraison" : "au retrait"),
        "center"
      )
    );
  }
  lines.push(dotted);
  // 8. Bloc infos client
  for (const l of wrap("Heure commande : " + order.orderedAt)) lines.push(l);
  for (const l of wrap("Client : " + order.customer)) lines.push(l);
  for (const l of wrap(
    "Telephone : " +
      (isDelivery && order.deliveryPhone ? order.deliveryPhone : order.phone)
  ))
    lines.push(l);
  if (isDelivery && order.address) {
    for (const l of wrap("Adresse : " + order.address)) lines.push(l);
  }
  lines.push(dotted);
  // 9. Pied
  for (const l of wrap(footer)) lines.push(pad("*" + l + "*", "center"));

  console.log(`\n+${"-".repeat(COLS)}+ (50 mm / 32 col. — ${order.mode})`);
  for (const l of lines) console.log("|" + l.padEnd(COLS).slice(0, COLS) + "|");
  console.log("+" + "-".repeat(COLS) + "+");
}

const base = {
  merchant: "Superette El Sar",
  orderNumber: "A042",
  customer: "Yacine Boudjellal",
  phone: "+213 555 12 34 56",
  orderedAt: "11:38, 31 mai",
  notes: "Sans oignons svp",
  items: [
    { cat: "Boulangerie", list: [{ qty: 2, name: "Baguette tradition" }] },
    { cat: "Viennoiseries", list: [{ qty: 4, name: "Croissant beurre" }] },
    {
      cat: "Sandwichs",
      list: [{ qty: 1, name: "Sandwich poulet maison artisanal" }],
    },
  ],
};

// Exemple RETRAIT (cash, pas d'adresse).
render({
  ...base,
  mode: "RETRAIT",
  time: "12:38",
  subtotal: 1750,
  fee: 0,
  total: 1750,
  cash: true,
});

// Exemple LIVRAISON (payé en ligne, adresse + frais).
render({
  ...base,
  orderNumber: "A043",
  mode: "LIVRAISON",
  time: "13:35",
  address: "Cite Iheddaden, Bat B, Apt 4, Bejaia",
  deliveryPhone: "+213 555 98 76 54",
  notes: "PAS DE SACHET",
  subtotal: 280,
  fee: 180,
  total: 460,
  cash: false,
});

console.log(
  "\nLegende : *gras*, **gras double-width**, [ ... ] = bandeau inverse — PIN jamais imprime."
);
