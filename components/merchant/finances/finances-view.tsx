"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Info,
  Loader2,
  Settings2,
  Truck,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/ui/pagination";
import { toast } from "@/components/ui/toast";
import { cn, formatDA } from "@/lib/utils";
import {
  PAYMENT_METHOD_META,
  PAYOUT_METHODS,
  PAYOUT_STATUS_META,
  WALLET_ENTRY_META,
  type PayoutRequest,
} from "@/lib/types";
import {
  requestPayout,
  type PayoutFormState,
} from "@/app/(merchant)/finances/actions";
import type { AdjustmentEntry, WalletEntryRow } from "@/lib/data/wallet";
import type { InvoiceMonth } from "@/lib/data/invoices";
import type { NextPayout } from "@/lib/finances/next-payout";
import type {
  DeliveryStats,
  FinancesSummary,
} from "@/app/(merchant)/finances/page";

const initialState: PayoutFormState = {};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-DZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    // timeZone FIXE (Alger) — sinon mismatch d'hydratation React #418.
    timeZone: "Africa/Algiers",
  });
}

export function FinancesView({
  entries,
  requests,
  summary,
  deliveryStats,
  invoiceMonths,
  page,
  pageCount,
  total,
  coligoPayBalance,
  nextPayout,
  adjustments,
}: {
  entries: WalletEntryRow[];
  requests: PayoutRequest[];
  summary: FinancesSummary;
  deliveryStats: DeliveryStats;
  invoiceMonths: InvoiceMonth[];
  page: number;
  pageCount: number;
  total: number;
  coligoPayBalance: number;
  nextPayout: NextPayout;
  adjustments: AdjustmentEntry[];
}) {
  const [showDetails, setShowDetails] = useState(page > 1);

  return (
    <div className="mx-auto max-w-[760px] p-4 lg:p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
          Mon argent
        </h1>
        <p className="text-muted mt-1 text-sm">
          Tout est réuni dans votre <strong>Coligo Pay</strong> : les paiements
          en ligne et cashback y arrivent automatiquement (commission déduite),
          et la commission des commandes en espèces y est prélevée.
        </p>
      </header>

      {/* ── SOLDE COLIGO PAY : le solde unique (revenus − commissions + recharge) ── */}
      <ColigoPayCard balance={coligoPayBalance} available={summary.available} />

      {/* ── LE VERDICT : la seule chose vraiment importante ── */}
      <Verdict summary={summary} />

      {/* ── Prochain virement automatique (date concrète) ── */}
      <NextPayoutBanner info={nextPayout} />

      {/* ── Versement (si Coligo vous doit de l'argent) ── */}
      {summary.available > 0 && <PayoutForm available={summary.available} />}

      {/* ── « D'où vient ce montant » — le calcul fait pour vous ── */}
      <SimpleBreakdown summary={summary} />

      {/* ── Pourquoi ces ajustements (motif + commande) ── */}
      <AdjustmentsCard adjustments={adjustments} />

      {/* ── Factures mensuelles téléchargeables ── */}
      <Invoices months={invoiceMonths} />

      {/* ── Le reste, replié (détail des opérations, livraisons, versements) ── */}
      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        className="border-border bg-surface text-foreground hover:bg-surface-2 mt-5 flex w-full items-center justify-between gap-2 rounded-[14px] border px-5 py-4 text-sm font-semibold transition-colors"
      >
        <span>Voir le détail (opérations, livraisons, versements)</span>
        <ChevronDown
          className={cn(
            "size-5 transition-transform",
            showDetails && "rotate-180"
          )}
        />
      </button>

      {showDetails && (
        <div className="mt-4 space-y-5">
          <DeliverySection stats={deliveryStats} />
          <History
            entries={entries}
            total={total}
            page={page}
            pageCount={pageCount}
          />
          <PayoutList requests={requests} />
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── COLIGO PAY ─────────────────────────── */

/** Solde UNIQUE de la Coligo Pay commerçant (revenus en ligne/cashback nets +
 *  recharges − commissions). C'est l'unique porte-monnaie : tout y converge. */
function ColigoPayCard({
  balance,
  available,
}: {
  balance: number;
  available: number;
}) {
  const negative = balance < 0;
  return (
    <section
      className={cn(
        "mb-3 rounded-[20px] p-6 text-white shadow-sm",
        negative
          ? "from-warning-500 to-warning-600 bg-gradient-to-br"
          : "from-primary-600 to-primary-800 bg-gradient-to-br"
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-white/85">
        <Wallet className="size-5" />
        Solde Coligo Pay
      </div>
      <p className="mt-2 text-[2.6rem] leading-none font-extrabold tracking-tight tabular-nums">
        {formatDA(balance)}
      </p>
      <p className="mt-3 text-sm text-white/90">
        {negative ? (
          <>À régulariser — rechargez pour repasser au vert.</>
        ) : available > 0 ? (
          <>
            <strong>{formatDA(available)}</strong> disponibles à retirer
          </>
        ) : (
          <>Votre porte-monnaie unique : paiements, commissions et recharges.</>
        )}
      </p>
      <Link
        href="/recharger"
        prefetch
        className="text-primary-700 mt-4 inline-flex h-10 items-center gap-2 rounded-[12px] bg-white px-4 text-sm font-bold"
      >
        <Wallet className="size-4" /> Recharger
      </Link>
    </section>
  );
}

/* ──────────────────────────── VERDICT ──────────────────────────── */

function Verdict({ summary }: { summary: FinancesSummary }) {
  // Trois états : Coligo vous doit / vous devez à Coligo / tout est à jour.
  if (summary.balance > 0) {
    return (
      <section className="from-success-600 to-success-700 mb-5 rounded-[20px] bg-gradient-to-br p-6 text-white shadow-sm">
        <div className="flex items-center gap-2 text-sm font-medium text-white/85">
          <Wallet className="size-5" />
          Coligo vous doit
        </div>
        <p className="mt-2 text-[2.6rem] leading-none font-extrabold tracking-tight tabular-nums">
          {formatDA(summary.balance)}
        </p>
        <div className="mt-3 text-sm text-white/90">
          {summary.reserved > 0 ? (
            <p>
              <strong>{formatDA(summary.available)}</strong> à retirer ·{" "}
              {formatDA(summary.reserved)} en cours de versement
            </p>
          ) : (
            <p>
              <strong>{formatDA(summary.available)}</strong> disponibles à
              retirer
            </p>
          )}
        </div>
      </section>
    );
  }

  if (summary.balance < 0) {
    return (
      <section className="from-warning-500 to-warning-600 mb-5 rounded-[20px] bg-gradient-to-br p-6 text-white shadow-sm">
        <div className="flex items-center gap-2 text-sm font-medium text-white/90">
          <Banknote className="size-5" />
          Vous devez à Coligo
        </div>
        <p className="mt-2 text-[2.6rem] leading-none font-extrabold tracking-tight tabular-nums">
          {formatDA(summary.debt)}
        </p>
        <p className="mt-3 text-sm text-white/95">
          C&apos;est la commission de vos <strong>ventes en espèces</strong> (le
          client vous a payé en main propre). À régler à Coligo.
        </p>
      </section>
    );
  }

  return (
    <section className="border-border bg-surface mb-5 flex items-center gap-3 rounded-[20px] border p-6 shadow-sm">
      <div className="bg-success-50 text-success-600 grid size-12 shrink-0 place-items-center rounded-full">
        <CheckCircle2 className="size-6" />
      </div>
      <div>
        <p className="text-lg font-bold">Tout est à jour ✅</p>
        <p className="text-muted text-sm">
          Aucun montant en attente, aucune dette. Tout est réglé.
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────── PROCHAIN VERSEMENT ─────────────────────── */

function cadenceLabel(c: "weekly" | "monthly"): string {
  return c === "weekly" ? "hebdomadaire" : "mensuel";
}

/** Bandeau « Prochain virement » — donne au commerçant une date concrète. */
function NextPayoutBanner({ info }: { info: NextPayout }) {
  // Auto désactivé : nudge discret vers le réglage (sans alarmer).
  if (info.kind === "manual") {
    return (
      <Link
        href="/settings"
        className="border-border bg-surface text-muted hover:bg-surface-2 mb-5 flex items-center gap-2.5 rounded-[14px] border px-4 py-3 text-sm transition-colors"
      >
        <Settings2 className="text-primary-500 size-4 shrink-0" />
        <span>
          Activez le{" "}
          <strong className="text-foreground">versement automatique</strong>{" "}
          pour être payé sans y penser.
        </span>
      </Link>
    );
  }

  if (info.kind === "frozen") {
    return (
      <div className="border-warning-200 bg-warning-50 text-warning-800 mb-5 flex items-center gap-2.5 rounded-[14px] border px-4 py-3 text-sm">
        <CalendarClock className="size-4 shrink-0" />
        <span>
          Versements <strong>suspendus</strong> (compte gelé). Contactez le
          support pour régulariser.
        </span>
      </div>
    );
  }

  if (info.kind === "needs_setup") {
    return (
      <Link
        href="/settings"
        className="border-warning-200 bg-warning-50 text-warning-800 hover:bg-warning-100 mb-5 flex items-center gap-2.5 rounded-[14px] border px-4 py-3 text-sm transition-colors"
      >
        <CalendarClock className="size-4 shrink-0" />
        <span>
          Versement {cadenceLabel(info.cadence)} activé —{" "}
          <strong>renseignez vos coordonnées</strong> de versement pour le
          déclencher.
        </span>
      </Link>
    );
  }

  if (info.kind === "waiting_balance") {
    return (
      <div className="border-border bg-surface text-muted mb-5 flex items-center gap-2.5 rounded-[14px] border px-4 py-3 text-sm">
        <CalendarClock className="text-primary-500 size-4 shrink-0" />
        <span>
          Versement {cadenceLabel(info.cadence)} automatique — dès que votre
          solde atteint{" "}
          <strong className="text-foreground">{formatDA(info.minDa)}</strong>.
        </span>
      </div>
    );
  }

  // scheduled — la date concrète.
  const d = new Date(info.date);
  const when = d.toLocaleDateString("fr-DZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Africa/Algiers",
  });
  return (
    <div className="border-primary-200 bg-primary-50/70 mb-5 flex items-center gap-3 rounded-[14px] border px-4 py-3.5">
      <div className="bg-primary-100 text-primary-700 grid size-9 shrink-0 place-items-center rounded-full">
        <CalendarClock className="size-5" />
      </div>
      <div className="min-w-0 text-sm">
        <p className="text-primary-900/70 text-xs font-medium">
          Prochain virement automatique ({cadenceLabel(info.cadence)})
        </p>
        <p className="text-foreground font-semibold capitalize">
          {when}{" "}
          <span className="text-success-700 font-bold tabular-nums">
            · ~{formatDA(info.available)}
          </span>
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────── DÉTAIL « FAIT POUR VOUS » ─────────────────────── */

function SimpleBreakdown({ summary }: { summary: FinancesSummary }) {
  const collectedForYou =
    summary.totalSales + summary.deliveryRevenue + summary.walletRedemption;
  const commission = -summary.totalCommission; // magnitude positive
  const hasAnything =
    collectedForYou > 0 ||
    commission > 0 ||
    summary.totalServiceFeesOwed > 0 ||
    summary.tourDeliveryCommission > 0 ||
    summary.totalPaidOut !== 0 ||
    summary.adjustments !== 0;

  if (!hasAnything) return null;

  return (
    <section className="border-border bg-surface mt-5 rounded-[16px] border p-5">
      <h2 className="mb-1 text-base font-semibold">Le détail du calcul</h2>
      <p className="text-muted mb-4 text-xs">
        Vert = pour vous · rouge = part Coligo.
      </p>

      <div className="divide-border divide-y">
        {collectedForYou > 0 && (
          <Line
            label="Encaissé pour vous"
            sub="Ventes en ligne, Coligo Pay, tournées"
            amount={collectedForYou}
            sign="+"
          />
        )}
        {commission > 0 && (
          <Line
            label="Commission Coligo (produits)"
            amount={commission}
            sign="−"
          />
        )}
        {summary.totalServiceFeesOwed > 0 && (
          <Line
            label="Frais de service (ventes espèces)"
            amount={summary.totalServiceFeesOwed}
            sign="−"
          />
        )}
        {summary.tourDeliveryCommission > 0 && (
          <Line
            label="Commission livraison (tournée)"
            amount={summary.tourDeliveryCommission}
            sign="−"
          />
        )}
        {summary.adjustments !== 0 && (
          <Line
            label="Ajustements"
            amount={Math.abs(summary.adjustments)}
            sign={summary.adjustments >= 0 ? "+" : "−"}
          />
        )}
        {summary.totalPaidOut !== 0 && (
          <Line
            label="Déjà versé sur votre compte"
            amount={Math.abs(summary.totalPaidOut)}
            sign="−"
            neutral
          />
        )}
      </div>

      <div className="border-border mt-1 flex items-center justify-between border-t-2 pt-3">
        <span className="text-base font-bold">
          {summary.balance >= 0 ? "Coligo vous doit" : "Vous devez à Coligo"}
        </span>
        <span
          className={cn(
            "text-lg font-extrabold tabular-nums",
            summary.balance >= 0 ? "text-success-700" : "text-warning-700"
          )}
        >
          {formatDA(Math.abs(summary.balance))}
        </span>
      </div>
    </section>
  );
}

function Line({
  label,
  sub,
  amount,
  sign,
  neutral,
}: {
  label: string;
  sub?: string;
  amount: number;
  sign: "+" | "−";
  neutral?: boolean;
}) {
  const tone = neutral
    ? "text-muted"
    : sign === "+"
      ? "text-success-700"
      : "text-danger-600";
  return (
    <div className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {sub && <p className="text-subtle mt-0.5 text-xs">{sub}</p>}
      </div>
      <span className={cn("shrink-0 text-sm font-bold tabular-nums", tone)}>
        {sign} {formatDA(amount)}
      </span>
    </div>
  );
}

/* ─────────────────────────── AJUSTEMENTS ─────────────────────────── */

/**
 * Détaille les ajustements (crédits/corrections manuels de Coligo) avec leur
 * MOTIF et la commande liée — au lieu d'un total muet « Ajustements ». Chaque
 * écriture porte un `note` obligatoire (contrainte DB), on l'affiche tel quel.
 */
function AdjustmentsCard({ adjustments }: { adjustments: AdjustmentEntry[] }) {
  if (adjustments.length === 0) return null;
  return (
    <section className="border-border bg-surface mt-5 rounded-[16px] border p-5">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
        <Info className="text-primary-500 size-4" />
        Ajustements expliqués
      </h2>
      <p className="text-muted mb-4 text-xs">
        Crédits et corrections appliqués par Coligo, avec leur motif.
      </p>
      <ul className="divide-border divide-y">
        {adjustments.map((a) => {
          const positive = a.amount_da >= 0;
          return (
            <li key={a.id} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {a.note?.trim() || "Ajustement"}
                </p>
                <p className="text-subtle mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                  <span>{formatDate(a.created_at)}</span>
                  {a.order_id && (
                    <Link
                      href={`/orders/${a.order_id}`}
                      className="text-primary-700 hover:underline"
                    >
                      voir la commande
                    </Link>
                  )}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 text-sm font-bold tabular-nums",
                  positive ? "text-success-700" : "text-danger-600"
                )}
              >
                {positive ? "+" : "−"} {formatDA(Math.abs(a.amount_da))}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ─────────────────────────── FACTURES ─────────────────────────── */

function Invoices({ months }: { months: InvoiceMonth[] }) {
  if (months.length === 0) return null;
  return (
    <section className="border-border bg-surface mt-5 rounded-[16px] border p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FileText className="text-primary-500 size-4" />
          Mes relevés mensuels
        </h2>
        {/* Export comptable de TOUTES les opérations. <a> car la route renvoie
            un fichier (Content-Disposition) → laisser le navigateur télécharger. */}
        <a
          href="/finances/export"
          className="border-border bg-surface-2 text-foreground hover:bg-surface-3 inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border px-3 py-2 text-xs font-semibold transition-colors"
        >
          <FileSpreadsheet className="size-3.5" />
          Exporter tout (CSV)
        </a>
      </div>
      <p className="text-muted mb-4 text-xs">
        Un récap clair par mois — PDF à imprimer, ou CSV pour votre comptable.
      </p>
      <ul className="divide-border divide-y">
        {months.map((m) => (
          <li
            key={m.key}
            className="flex items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold capitalize">{m.label}</p>
              <p className="text-subtle text-xs">
                {m.ordersCount} commande{m.ordersCount > 1 ? "s" : ""} ·
                encaissé {formatDA(m.collectedForYou)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/finances/factures/${m.key}`}
                className="border-border bg-surface-2 text-foreground hover:bg-surface-3 inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-xs font-semibold transition-colors"
              >
                <Download className="size-3.5" />
                PDF
              </Link>
              <a
                href={`/finances/export?month=${m.key}`}
                className="border-border bg-surface-2 text-foreground hover:bg-surface-3 inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-xs font-semibold transition-colors"
              >
                <FileSpreadsheet className="size-3.5" />
                CSV
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ─────────────────────── DÉTAILS REPLIÉS ─────────────────────── */

function DeliverySection({ stats }: { stats: DeliveryStats }) {
  if (stats.totalDeliveryOrders === 0) return null;
  return (
    <section className="border-border bg-surface rounded-[16px] border p-5">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
        <Truck className="size-4" />
        Livraisons
      </h2>
      <div className="grid grid-cols-2 gap-3">
        <MiniStat
          label="Livraisons"
          value={`${stats.completedDeliveryOrders}/${stats.totalDeliveryOrders}`}
          sub="livrées / total"
        />
        {stats.owedByDriversDa > 0 && (
          <MiniStat
            label="Avances reçues des livreurs"
            value={formatDA(stats.owedByDriversDa)}
            sub="payées en main propre au retrait (COD)"
          />
        )}
      </div>
    </section>
  );
}

function MiniStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "amber";
}) {
  return (
    <div
      className={cn(
        "rounded-[12px] p-3",
        tone === "amber" ? "bg-warning-50 text-warning-800" : "bg-surface-2"
      )}
    >
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
      <p className="text-xs opacity-70">{sub}</p>
    </div>
  );
}

function History({
  entries,
  total,
  page,
  pageCount,
}: {
  entries: WalletEntryRow[];
  total: number;
  page: number;
  pageCount: number;
}) {
  return (
    <section className="border-border bg-surface rounded-[16px] border">
      <header className="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
        <h2 className="text-base font-semibold">Toutes les opérations</h2>
        {total > 0 && (
          <span className="text-muted text-xs tabular-nums">
            {total} ligne{total > 1 ? "s" : ""}
          </span>
        )}
      </header>
      {entries.length === 0 ? (
        <p className="text-muted px-5 py-10 text-center text-sm">
          Aucune opération pour le moment. Vos gains apparaîtront ici dès
          qu&apos;une commande sera récupérée.
        </p>
      ) : (
        <>
          <ul className="divide-border divide-y">
            {entries.map((e) => (
              <EntryRow key={e.id} entry={e} />
            ))}
          </ul>
          {pageCount > 1 && (
            <div className="border-border border-t px-5 py-3">
              <Pagination
                page={page}
                pageCount={pageCount}
                hrefFor={(p) => (p > 1 ? `/finances?page=${p}` : "/finances")}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function EntryRow({ entry }: { entry: WalletEntryRow }) {
  const meta = WALLET_ENTRY_META[entry.type] ?? {
    label: entry.type,
    tone: "neutral" as const,
  };
  const positive = entry.amount_da >= 0;
  const method = entry.orders?.payment_method;
  return (
    <li className="flex items-center gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          {entry.coligo_pay_payment_id && (
            <Badge tone="primary">Coligo Pay</Badge>
          )}
          {method && (
            <Badge tone={PAYMENT_METHOD_META[method].tone}>
              {PAYMENT_METHOD_META[method].short}
            </Badge>
          )}
          {entry.order_id && (
            <Link
              href={`/orders/${entry.order_id}`}
              className="text-primary-700 text-xs hover:underline"
            >
              commande
            </Link>
          )}
        </div>
        <p className="text-subtle mt-1 text-xs">
          {formatDate(entry.created_at)}
          {entry.commission_rate != null &&
            ` · ${Math.round(entry.commission_rate * 100)} %`}
          {entry.note && ` · ${entry.note}`}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          positive ? "text-success-700" : "text-danger-600"
        )}
      >
        {positive ? "+" : ""}
        {formatDA(entry.amount_da)}
      </span>
    </li>
  );
}

function PayoutForm({ available }: { available: number }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    requestPayout,
    initialState
  );

  useEffect(() => {
    if (state.ok) {
      toast.success("Demande de versement envoyée");
      formRef.current?.reset();
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  if (!open) {
    return (
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-1 w-full"
        size="lg"
      >
        <Banknote className="size-4" />
        Demander mon versement ({formatDA(available)})
      </Button>
    );
  }

  return (
    <section className="border-border bg-surface mb-1 rounded-[16px] border p-5">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
        <Banknote className="text-primary-500 size-4" />
        Demander mon versement
      </h2>
      <p className="text-muted mb-4 text-xs">
        Disponible : {formatDA(Math.max(0, available))}
      </p>
      <form ref={formRef} action={formAction} className="space-y-4">
        <div className="space-y-1.5">
          <Label>
            Combien retirer ? (DA)<span className="text-rose-600"> *</span>
          </Label>
          <div className="relative">
            <Input
              ref={amountRef}
              type="number"
              name="amount_da"
              min={1}
              max={available}
              step={1}
              placeholder="0"
              required
              disabled={pending}
              className="pr-16"
            />
            <button
              type="button"
              onClick={() => {
                if (amountRef.current)
                  amountRef.current.value = String(available);
              }}
              disabled={pending}
              className="text-primary-700 absolute top-1/2 right-3 -translate-y-1/2 text-xs font-semibold hover:underline"
            >
              Tout
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Comment être payé ?</Label>
          <select
            name="method"
            defaultValue="ccp"
            disabled={pending}
            className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 h-12 w-full rounded-[12px] border px-4 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
          >
            {PAYOUT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label>
            Vos coordonnées (n° CCP / RIB)
            <span className="text-rose-600"> *</span>
          </Label>
          <textarea
            name="details"
            rows={2}
            placeholder="Ex. CCP 00799999 clé 25"
            required
            disabled={pending}
            className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 w-full rounded-[12px] border px-4 py-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
          />
        </div>

        {state.error && (
          <p className="text-danger-600 text-sm">{state.error}</p>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Annuler
          </Button>
          <Button type="submit" className="flex-1" disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Banknote className="size-4" />
            )}
            Envoyer la demande
          </Button>
        </div>
      </form>
    </section>
  );
}

function PayoutList({ requests }: { requests: PayoutRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <section className="border-border bg-surface rounded-[16px] border p-5">
      <h2 className="mb-3 text-base font-semibold">
        Mes demandes de versement
      </h2>
      <ul className="space-y-2.5">
        {requests.map((r) => {
          const meta = PAYOUT_STATUS_META[r.status];
          return (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-semibold tabular-nums">
                  {formatDA(r.amount_da)}
                </p>
                <p className="text-subtle text-xs">
                  {formatDate(r.created_at)} · {r.method.toUpperCase()}
                </p>
              </div>
              <Badge tone={meta.tone}>{meta.label}</Badge>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
