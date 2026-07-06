import { getPayoutStatement } from "@/lib/data/payout-statements";
import { formatCsvDate, toCsv } from "@/lib/finances/wallet-csv";

export const dynamic = "force-dynamic";

/**
 * Facture DÉTAILLÉE d'un versement au format CSV (une ligne par commande de la
 * période couverte) — pendant tableur du PDF ?detail=1, pour le comptable.
 * Auth : session commerçant (getPayoutStatement, RLS) → chacun n'exporte que
 * SES versements payés. Format Excel FR/DZ (« ; », BOM UTF-8, CRLF).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const st = await getPayoutStatement(id);
  if (!st) {
    return new Response("Versement introuvable, non payé ou non authentifié", {
      status: 404,
    });
  }

  const headers = [
    "Commande",
    "Date",
    "Client",
    "Paiement",
    "Produits (DA)",
    "Frais de livraison (DA)",
    "Commission Coligo (DA)",
    "Frais de service (DA)",
    "Remboursements (DA)",
    "Net reversé (DA)",
  ];
  const rows = st.orders.map((o) => [
    o.orderNumber,
    formatCsvDate(o.createdAt),
    o.customerName ?? "",
    o.paymentMethod === "cash" ? "Espèces" : "En ligne",
    String(o.productsDa),
    String(o.deliveryFeeDa),
    String(-o.commissionDa),
    String(-o.serviceFeeDa),
    String(o.refundsDa),
    String(o.netDa),
  ]);
  // Ligne de synthèse finale : totaux + montant net versé.
  rows.push([
    "TOTAUX",
    "",
    `${st.ordersCount} commandes · ${st.periodLabel}`,
    "",
    String(st.totals.salesDa),
    String(st.totals.deliveryFeesDa),
    String(-st.totals.commissionDa),
    String(-st.totals.serviceFeesDa),
    String(st.totals.adjustmentsDa),
    "",
  ]);
  rows.push([
    "MONTANT NET VERSÉ",
    formatCsvDate(st.periodTo),
    `Facture ${st.invoiceNumber} · réf. ${st.reference}`,
    st.payout.method.toUpperCase(),
    "",
    "",
    "",
    "",
    "",
    String(st.totals.paidDa),
  ]);

  const csv = toCsv(headers, rows);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="facture-versement-${st.invoiceNumber}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
