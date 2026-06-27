// Test PUR — sérialisation CSV du relevé commerçant (échappement, BOM, format).
// Exécution : node --experimental-strip-types scripts/test-wallet-csv.mjs
import {
  escapeCsvCell,
  toCsv,
  walletEntriesToCsv,
  formatCsvDate,
} from "../lib/finances/wallet-csv.ts";

let pass = 0,
  fail = 0;
const ok = (c, l) =>
  c ? (pass++, console.log("  ✅", l)) : (fail++, console.log("  ❌", l));

console.log("→ Échappement RFC 4180 (séparateur ;)");
ok(escapeCsvCell("simple") === "simple", "Texte simple non modifié");
ok(
  escapeCsvCell("a;b") === '"a;b"',
  "Point-virgule → cellule entre guillemets"
);
ok(
  escapeCsvCell('dit "bonjour"') === '"dit ""bonjour"""',
  "Guillemets doublés"
);
ok(
  escapeCsvCell("ligne1\nligne2") === '"ligne1\nligne2"',
  "Saut de ligne → entre guillemets"
);

console.log("→ Structure CSV");
const csv = toCsv(
  ["A", "B"],
  [
    ["1", "2"],
    ["x;y", "z"],
  ]
);
ok(csv.charCodeAt(0) === 0xfeff, "Commence par un BOM UTF-8");
ok(csv.includes("\r\n"), "Fins de ligne CRLF");
const body = csv.slice(1); // sans BOM
const lines = body.split("\r\n").filter(Boolean);
ok(lines[0] === "A;B", "En-têtes séparés par ;");
ok(lines[1] === "1;2", "Ligne simple");
ok(lines[2] === '"x;y";z', "Cellule avec ; échappée");

console.log("→ Date (fuseau Alger)");
// Alger = UTC+1, sans heure d'été. 28/06 10:00Z → 11:00 Alger.
ok(
  formatCsvDate("2026-06-28T10:00:00Z") === "28/06/2026 11:00",
  `Date Alger (got ${formatCsvDate("2026-06-28T10:00:00Z")})`
);

console.log("→ Mapping des écritures");
const LABELS = { sale: "Vente", commission: "Commission Coligo" };
const out = walletEntriesToCsv(
  [
    {
      created_at: "2026-06-28T10:00:00Z",
      type: "sale",
      order_number: "A042",
      payment_method: "online",
      amount_da: 1000,
      note: null,
    },
    {
      created_at: "2026-06-28T10:05:00Z",
      type: "commission",
      order_number: "A042",
      payment_method: "online",
      amount_da: -100,
      note: "Remboursement; partiel",
    },
  ],
  (t) => LABELS[t] ?? t
);
const rows = out.slice(1).split("\r\n").filter(Boolean);
ok(
  rows[0] === "Date;Opération;Commande;Mode de paiement;Montant (DA);Note",
  "En-tête métier correct"
);
ok(rows[1] === "28/06/2026 11:00;Vente;A042;En ligne;1000;", "Ligne vente");
ok(
  rows[2].endsWith(';"Remboursement; partiel"'),
  "Note avec ; échappée + montant négatif"
);
ok(rows[2].includes(";-100;"), "Montant négatif conservé");

console.log(`\n${pass} ✅  ${fail} ❌`);
process.exit(fail ? 1 : 0);
