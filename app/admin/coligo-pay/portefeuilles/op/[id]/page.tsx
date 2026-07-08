import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDA } from "@/lib/utils";
import { OperatorWalletPanel } from "@/components/admin/coligo-pay/operator-wallet-panel";
import { getOperatorWalletDetail } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * Fiche PORTEFEUILLE OPÉRATEUR (livreur / chauffeur / commerçant / Agent
 * Coligo Pay) : solde, dette de rôle (encours livreur/chauffeur), 100
 * dernières écritures (grand livre immuable), crédit/débit motivé, gel,
 * versement agent. Réutilise admin_operator_credit / setWalletStatus /
 * recordPartnerPayout (rien de dupliqué).
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

const KIND_LABEL: Record<string, string> = {
  driver: "Livreur",
  chauffeur: "Chauffeur",
  merchant: "Commerçant",
  partner: "Agent Coligo Pay",
};

const ENTRY_LABEL: Record<string, string> = {
  topup_chargily: "Recharge carte",
  topup_manual: "Recharge manuelle",
  topup_partner: "Recharge via agent",
  recharge_sale: "Vente de crédit (agent)",
  bonus: "Bonus / indemnité",
  fee_debit: "Frais",
  service_fee: "Frais de service",
  cod_settle: "Règlement encours",
  adjustment: "Ajustement",
  finance_mirror: "Miroir finances commerçant",
  payout: "Versement",
};

export default async function OperatorWalletPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getOperatorWalletDetail(id);
  if (!detail) notFound();
  const { wallet, ownerName, ownerPhone, balanceDa, debtDa, entries } = detail;

  const ownerLink =
    wallet.owner_type === "driver"
      ? `/admin/drivers/${wallet.owner_id}`
      : wallet.owner_type === "chauffeur"
        ? `/admin/chauffeurs/${wallet.owner_id}`
        : wallet.owner_type === "partner"
          ? `/admin/agents/${wallet.id}`
          : null;

  return (
    <div>
      <Link
        href="/admin/coligo-pay/portefeuilles"
        className="text-muted hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
      >
        <ArrowLeft className="size-4" />
        Portefeuilles
      </Link>

      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight">{ownerName}</h1>
          <Badge tone="neutral">
            {KIND_LABEL[wallet.owner_type] ?? wallet.owner_type}
          </Badge>
          {wallet.status !== "active" && (
            <Badge tone="danger">
              {wallet.status === "suspended" ? "Suspendu" : wallet.status}
            </Badge>
          )}
        </div>
        <p className="text-muted mt-1 text-sm">
          {ownerPhone ?? "—"}
          {ownerLink ? (
            <>
              {" · "}
              <Link
                href={ownerLink}
                className="text-primary-700 font-semibold hover:underline"
              >
                Sa fiche →
              </Link>
            </>
          ) : null}
        </p>
      </header>

      {/* ---- Soldes ---- */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <section className="border-border bg-surface rounded-[14px] border p-4">
          <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
            <Wallet className="size-3.5" />
            Solde portefeuille
          </h2>
          <p
            className={
              "mt-2 text-2xl font-bold tabular-nums " +
              (balanceDa < 0 ? "text-danger-700" : "")
            }
          >
            {formatDA(balanceDa)}
          </p>
        </section>
        {debtDa > 0 && (
          <section className="border-warning-200 bg-surface rounded-[14px] border p-4">
            <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
              <AlertTriangle className="size-3.5" />
              Encours à reverser (dette de rôle)
            </h2>
            <p className="text-warning-800 mt-2 text-2xl font-bold tabular-nums">
              {formatDA(debtDa)}
            </p>
          </section>
        )}
      </div>

      {/* ---- Gestion ---- */}
      <OperatorWalletPanel
        walletId={wallet.id}
        status={wallet.status}
        isPartner={wallet.is_partner || wallet.owner_type === "partner"}
      />

      {/* ---- Écritures ---- */}
      <section className="border-border bg-surface mt-3 rounded-[14px] border p-4">
        <h2 className="text-muted text-xs font-bold uppercase">
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
                  {dt(e.created_at)} · {ENTRY_LABEL[e.type] ?? e.type}
                  {e.note ? ` — ${e.note}` : ""}
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
