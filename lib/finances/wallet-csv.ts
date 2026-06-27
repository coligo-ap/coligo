// =============================================================================
// Export CSV du relevé commerçant — sérialisation PURE (pour le comptable).
// =============================================================================
// Choix de format pensés pour Excel FR/DZ :
//   - séparateur « ; » (Excel francophone l'attend par défaut) ;
//   - BOM UTF-8 en tête → accents et arabe lus correctement ;
//   - fins de ligne CRLF (compat Windows/Excel) ;
//   - échappement RFC 4180 (guillemets doublés, cellule entre guillemets si elle
//     contient « ; », un guillemet ou un saut de ligne).
// =============================================================================
// Serializer PUR (sans dépendance) : le libellé d'opération est injecté par
// l'appelant (résolveur `labelFor`) — la route passe WALLET_ENTRY_META.
// =============================================================================

const DELIM = ";";
const EOL = "\r\n";
const BOM = "﻿";

/** Échappe une cellule selon RFC 4180 (adaptée au séparateur « ; »). */
export function escapeCsvCell(value: string): string {
  if (/[";\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Assemble un CSV complet (BOM + en-têtes + lignes). */
export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((cells) =>
    cells.map((c) => escapeCsvCell(c ?? "")).join(DELIM)
  );
  return BOM + lines.join(EOL) + EOL;
}

export type WalletCsvEntry = {
  created_at: string;
  type: string;
  order_number: string | null;
  payment_method: "cash" | "online" | null;
  amount_da: number;
  note: string | null;
};

const DATE_PARTS = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Africa/Algiers",
});

/** « JJ/MM/AAAA HH:MM » en fuseau Alger (déterministe). */
export function formatCsvDate(iso: string): string {
  const p = DATE_PARTS.formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

const PAYMENT_LABEL: Record<"cash" | "online", string> = {
  cash: "Espèces",
  online: "En ligne",
};

/**
 * Transforme les écritures wallet en CSV téléchargeable.
 * @param labelFor résout le libellé FR d'un type d'opération (WALLET_ENTRY_META).
 */
export function walletEntriesToCsv(
  entries: WalletCsvEntry[],
  labelFor: (type: string) => string = (t) => t
): string {
  const headers = [
    "Date",
    "Opération",
    "Commande",
    "Mode de paiement",
    "Montant (DA)",
    "Note",
  ];
  const rows = entries.map((e) => [
    formatCsvDate(e.created_at),
    labelFor(e.type),
    e.order_number ?? "",
    e.payment_method ? PAYMENT_LABEL[e.payment_method] : "",
    String(e.amount_da),
    e.note ?? "",
  ]);
  return toCsv(headers, rows);
}
