import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Coins,
  QrCode,
  User,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDA } from "@/lib/utils";
import { CustomerWalletPanel } from "@/components/admin/coligo-pay/customer-wallet-panel";
import { getCustomerWalletDetail } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * Fiche PORTEFEUILLE CLIENT : soldes exacts (Coligo Pay + cashback), 100
 * dernières écritures, transferts P2P et paiements QR, ajustement motivé
 * (crédit/débit) audité + notifié. Liens croisés vers ses commandes/courses.
 */

const dt = (v: string) =>
  new Date(v).toLocaleString("fr-DZ", {
    timeZone: "Africa/Algiers",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const ENTRY_LABEL: Record<string, string> = {
  cashback_earned: "Cashback gagné",
  cashback_spent: "Cashback utilisé",
  topup_credit: "Crédit Coligo Pay",
  topup_spent: "Coligo Pay utilisé",
  transfer_in: "Transfert reçu",
  transfer_out: "Transfert envoyé",
  voucher_credit: "Bon plateforme",
  adjustment: "Ajustement support",
};

export default async function CustomerWalletPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getCustomerWalletDetail(id);
  if (!detail) notFound();
  const { customer, topupDa, cashbackDa, entries, transfers, payments } =
    detail;

  return (
    <div>
      <Link
        href="/admin/coligo-pay/portefeuilles"
        className="text-muted hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
      >
        <ArrowLeft className="size-4" />
        Portefeuilles
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">
              {customer.full_name}
            </h1>
            <Badge tone="neutral">Client</Badge>
          </div>
          <p className="text-muted mt-1 text-sm">
            {customer.phone ?? "—"}
            {customer.pay_handle ? ` · @${customer.pay_handle}` : ""} · client
            depuis le {dt(customer.created_at)}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
            <Link
              href={`/admin/orders?q=${customer.id}`}
              className="text-primary-700 font-semibold hover:underline"
            >
              Ses commandes →
            </Link>
            <Link
              href={`/admin/chauffeurs/courses?q=${customer.id}`}
              className="text-primary-700 font-semibold hover:underline"
            >
              Ses courses Drive →
            </Link>
          </div>
        </div>
      </header>

      {/* ---- Soldes ---- */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <section className="border-border bg-surface rounded-card-lg border p-4">
          <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
            <Wallet className="size-3.5" />
            Solde Coligo Pay
          </h2>
          <p className="mt-2 text-2xl font-bold tabular-nums">
            {formatDA(topupDa)}
          </p>
        </section>
        <section className="border-border bg-surface rounded-card-lg border p-4">
          <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
            <Coins className="size-3.5" />
            Cashback
          </h2>
          <p className="mt-2 text-2xl font-bold tabular-nums">
            {formatDA(cashbackDa)}
          </p>
        </section>
      </div>

      {/* ---- Gestion ---- */}
      <CustomerWalletPanel customerId={customer.id} />

      {/* ---- P2P + QR ---- */}
      {(transfers.length > 0 || payments.length > 0) && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {transfers.length > 0 && (
            <section className="border-border bg-surface rounded-card-lg border p-4">
              <h2 className="text-muted text-xs font-bold uppercase">
                Transferts P2P récents
              </h2>
              <ul className="mt-2 space-y-1 text-xs">
                {transfers.slice(0, 10).map((t) => (
                  <li
                    key={t.id}
                    className="text-muted flex items-center justify-between gap-2"
                  >
                    <span className="inline-flex min-w-0 items-center gap-1">
                      {t.direction === "in" ? (
                        <ArrowDownLeft className="text-success-600 size-3 shrink-0" />
                      ) : (
                        <ArrowUpRight className="text-danger-600 size-3 shrink-0" />
                      )}
                      <span className="truncate">
                        {t.direction === "in" ? "De" : "Vers"}{" "}
                        {t.other_name ?? "—"} · {dt(t.created_at)}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {t.direction === "in" ? "+" : "−"}
                      {formatDA(t.amount_da)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {payments.length > 0 && (
            <section className="border-border bg-surface rounded-card-lg border p-4">
              <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
                <QrCode className="size-3.5" />
                Paiements marchands récents
              </h2>
              <ul className="mt-2 space-y-1 text-xs">
                {payments.slice(0, 10).map((p) => (
                  <li
                    key={p.id}
                    className="text-muted flex items-center justify-between gap-2"
                  >
                    <span className="truncate">
                      {p.merchant_name ?? "—"} · {dt(p.created_at)}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      −{formatDA(p.amount_da)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* ---- Écritures ---- */}
      <section className="border-border bg-surface rounded-card-lg mt-3 border p-4">
        <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
          <User className="size-3.5" />
          Écritures ({entries.length} dernières)
        </h2>
        {entries.length === 0 ? (
          <p className="text-muted mt-2 text-sm">Aucune écriture.</p>
        ) : (
          <ul className="divide-border mt-2 divide-y">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 py-1.5 text-xs"
              >
                <span className="text-muted min-w-0 truncate">
                  {dt(e.created_at)} · {ENTRY_LABEL[e.type] ?? e.type} (
                  {e.source ?? "—"}){e.note ? ` — ${e.note}` : ""}
                </span>
                <span
                  className={
                    "shrink-0 font-bold tabular-nums " +
                    (e.amount_da >= 0 ? "text-success-700" : "text-danger-700")
                  }
                >
                  {e.amount_da >= 0 ? "+" : ""}
                  {formatDA(e.amount_da)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
