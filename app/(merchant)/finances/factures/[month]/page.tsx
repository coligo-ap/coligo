import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown } from "lucide-react";
import { getInvoice } from "@/lib/data/invoices";
import { formatDA } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ month: string }>;
}) {
  const { month } = await params;
  const inv = await getInvoice(month);
  if (!inv) notFound();

  return (
    <div className="mx-auto max-w-[760px] p-4 lg:p-6">
      {/* Barre d'actions : le téléchargement ouvre un VRAI PDF A4 généré
          serveur (/api/pdf/facture) — plus de window.print de la page web. */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <Link
          href="/finances"
          className="text-muted hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
        >
          <ArrowLeft className="size-4" />
          Retour
        </Link>
        <a
          href={`/api/pdf/facture/${month}`}
          target="_blank"
          rel="noopener"
          className="bg-primary-600 inline-flex items-center gap-2 rounded-[12px] px-4 py-2.5 text-sm font-bold text-white shadow-sm"
        >
          <FileDown className="size-4" />
          Télécharger (PDF)
        </a>
      </div>

      {/* La facture */}
      <div
        id="invoice"
        className="border-border bg-surface rounded-[16px] border p-6 lg:p-8"
      >
        <header className="border-border flex items-start justify-between gap-4 border-b pb-5">
          <div>
            <p className="text-primary-700 text-xl font-extrabold tracking-tight">
              Coligo
            </p>
            <p className="text-muted text-xs">Relevé mensuel commerçant</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold capitalize">{inv.label}</p>
            <p className="text-subtle text-xs">
              Édité le {inv.generatedAtLabel}
            </p>
          </div>
        </header>

        <section className="border-border border-b py-5">
          <p className="text-subtle text-xs font-medium tracking-wide uppercase">
            Commerçant
          </p>
          <p className="mt-1 text-base font-semibold">{inv.merchant.name}</p>
          {(inv.merchant.address || inv.merchant.city) && (
            <p className="text-muted text-sm">
              {[inv.merchant.address, inv.merchant.city]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <p className="text-muted mt-2 text-sm">
            {inv.ordersCount} commande{inv.ordersCount > 1 ? "s" : ""} sur la
            période.
          </p>
        </section>

        <section className="py-5">
          <Row
            label="Encaissé pour vous"
            hint="Ventes en ligne, QR Coligo Pay et livraisons de tournée"
            amount={inv.collectedForYou}
            sign="+"
          />
          {inv.commission > 0 && (
            <Row
              label="Commission Coligo (produits)"
              amount={inv.commission}
              sign="−"
            />
          )}
          {inv.serviceFees > 0 && (
            <Row
              label="Frais de service (ventes espèces)"
              amount={inv.serviceFees}
              sign="−"
            />
          )}
          {inv.tourCommission > 0 && (
            <Row
              label="Commission livraison (tournée)"
              amount={inv.tourCommission}
              sign="−"
            />
          )}
          {inv.adjustments !== 0 && (
            <Row
              label="Ajustements"
              amount={Math.abs(inv.adjustments)}
              sign={inv.adjustments >= 0 ? "+" : "−"}
            />
          )}
          {inv.payouts !== 0 && (
            <Row
              label="Versements effectués vers votre compte"
              amount={Math.abs(inv.payouts)}
              sign="−"
            />
          )}

          <div className="border-border mt-2 flex items-center justify-between border-t-2 pt-4">
            <span className="text-base font-bold">
              {inv.net >= 0 ? "En votre faveur ce mois" : "À régler à Coligo"}
            </span>
            <span className="text-xl font-extrabold tabular-nums">
              {formatDA(Math.abs(inv.net))}
            </span>
          </div>
        </section>

        <footer className="border-border text-subtle border-t pt-4 text-xs">
          Document généré automatiquement par Coligo. Les commissions et frais
          indiqués sont ceux appliqués au moment de chaque commande (montants
          figés). Ce relevé ne tient pas lieu de facture fiscale.
        </footer>
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  amount,
  sign,
}: {
  label: string;
  hint?: string;
  amount: number;
  sign: "+" | "−";
}) {
  return (
    <div className="border-border/60 flex items-start justify-between gap-3 border-b py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-subtle text-xs">{hint}</p>}
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums">
        {sign} {formatDA(amount)}
      </span>
    </div>
  );
}
