"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Banknote,
  Calculator,
  CalendarClock,
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
import type { CashDebtStatus } from "@/lib/finances/cash-debt";
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

export type HistoryFilters = {
  type: string;
  month: string;
  from: string;
  to: string;
  active: boolean;
};

export function FinancesView({
  entries,
  historyFilters,
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
  cashDebt,
}: {
  entries: WalletEntryRow[];
  historyFilters: HistoryFilters;
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
  cashDebt: CashDebtStatus;
}) {
  // Présence d'un détail de calcul (mêmes conditions que SimpleBreakdown) :
  // sert à n'afficher la sous-section « Le détail du calcul » que si elle a du
  // contenu (sinon un accordéon se déplierait sur du vide).
  const hasBreakdown =
    summary.totalSales + summary.deliveryRevenue + summary.walletRedemption >
      0 ||
    -summary.totalCommission > 0 ||
    summary.totalServiceFeesOwed > 0 ||
    summary.tourDeliveryCommission > 0 ||
    summary.totalPaidOut !== 0 ||
    summary.adjustments !== 0;

  return (
    <div className="mx-auto max-w-[680px] p-4 lg:p-6">
      <header className="mb-4">
        <h1 className="text-xl font-bold tracking-tight lg:text-2xl">
          Mon argent
        </h1>
        <p className="text-muted mt-0.5 text-[13px] leading-snug">
          Tout converge dans votre{" "}
          <strong className="text-foreground">Coligo Pay</strong> : paiements en
          ligne, cashback et commissions.
        </p>
      </header>

      {/* ════════════════ L'ESSENTIEL (toujours visible) ════════════════
          UNE carte = LE chiffre (solde Coligo Pay ≡ « Coligo vous doit »)
          + les actions (versement / recharge). Plus de verdict séparé ni de
          bouton isolé qui répétaient le même montant 5 fois. */}
      <EssentialMoney
        balance={coligoPayBalance}
        summary={summary}
        cashDebt={cashDebt}
        nextPayout={nextPayout}
      />

      {/* ════════════════ LES DÉTAILS (sous-sections repliables) ════════════════
          Tout le reste est rangé en accordéons FERMÉS par défaut : la page reste
          courte et lisible, on n'ouvre que ce dont on a besoin. */}
      <p className="text-subtle mt-6 mb-2 px-1 text-[11px] font-bold tracking-wider uppercase">
        Détails &amp; documents
      </p>
      <div className="space-y-3">
        {hasBreakdown && (
          <CollapsibleSection
            icon={<Calculator className="size-4" />}
            title="Le détail du calcul"
            subtitle="D'où vient votre solde, ligne par ligne"
          >
            <SimpleBreakdown summary={summary} />
          </CollapsibleSection>
        )}

        {adjustments.length > 0 && (
          <CollapsibleSection
            icon={<Info className="size-4" />}
            title="Ajustements expliqués"
            subtitle="Crédits et corrections appliqués par Coligo"
            right={<CountChip n={adjustments.length} />}
          >
            <AdjustmentsCard adjustments={adjustments} />
          </CollapsibleSection>
        )}

        {invoiceMonths.length > 0 && (
          <CollapsibleSection
            icon={<FileText className="size-4" />}
            title="Relevés &amp; factures"
            subtitle="Récap mensuel — PDF ou CSV pour le comptable"
            right={<CountChip n={invoiceMonths.length} />}
          >
            <Invoices months={invoiceMonths} />
          </CollapsibleSection>
        )}

        {deliveryStats.totalDeliveryOrders > 0 && (
          <CollapsibleSection
            icon={<Truck className="size-4" />}
            title="Livraisons"
            subtitle="Suivi des livraisons et avances livreurs"
          >
            <DeliverySection stats={deliveryStats} />
          </CollapsibleSection>
        )}

        <CollapsibleSection
          icon={<Wallet className="size-4" />}
          title="Historique des opérations"
          subtitle="Filtrable par type et par période"
          right={total > 0 ? <CountChip n={total} /> : undefined}
          // Ouvert direct si pagination ou filtres actifs dans l'URL.
          defaultOpen={page > 1 || historyFilters.active}
        >
          <History
            entries={entries}
            page={page}
            pageCount={pageCount}
            filters={historyFilters}
          />
        </CollapsibleSection>

        {requests.length > 0 && (
          <CollapsibleSection
            icon={<Banknote className="size-4" />}
            title="Demandes de versement"
            subtitle="Statut de vos retraits"
            right={<CountChip n={requests.length} />}
          >
            <PayoutList requests={requests} />
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}

/* ─────────────────── SOUS-SECTION REPLIABLE (accordéon) ─────────────────── */

/**
 * Carte-section dépliable, FERMÉE par défaut. En-tête : pastille d'icône +
 * titre + sous-titre + compteur optionnel (à droite) + chevron. Donne à la page
 * finances une organisation claire « sous-section par sous-section ».
 */
function CollapsibleSection({
  icon,
  title,
  subtitle,
  right,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-border bg-surface overflow-hidden rounded-[16px] border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="hover:bg-surface-2 flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors"
      >
        <span className="bg-primary-50 text-primary-600 grid size-9 shrink-0 place-items-center rounded-full">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          {subtitle && (
            <span className="text-subtle mt-0.5 block text-xs leading-snug">
              {subtitle}
            </span>
          )}
        </span>
        {right}
        <ChevronDown
          className={cn(
            "text-muted size-5 shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && <div className="border-border border-t p-4">{children}</div>}
    </section>
  );
}

/** Petit compteur (pastille) affiché à droite de l'en-tête d'une sous-section. */
function CountChip({ n }: { n: number }) {
  return (
    <span className="bg-surface-2 text-muted shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums">
      {n}
    </span>
  );
}

/* ─────────────── L'ESSENTIEL : UNE carte, UN chiffre, LES actions ─────────────── */

/**
 * Pour un commerçant, solde Coligo Pay ≡ « Coligo vous doit » (positif) ou
 * « Vous devez à Coligo » (négatif) : c'est UNE information — elle n'apparaît
 * donc qu'UNE fois, dans cette carte, avec les actions qui en découlent
 * (demander le versement / recharger). Le formulaire de versement s'ouvre
 * depuis la carte ; les bannières contextuelles (dette, prochain virement)
 * suivent sans re-citer le montant.
 */
function EssentialMoney({
  balance,
  summary,
  cashDebt,
  nextPayout,
}: {
  balance: number;
  summary: FinancesSummary;
  cashDebt: CashDebtStatus;
  nextPayout: NextPayout;
}) {
  const [payoutOpen, setPayoutOpen] = useState(false);
  const negative = balance < 0;
  const canWithdraw = summary.available > 0;

  return (
    <div className="space-y-3">
      <section
        className={cn(
          "relative overflow-hidden rounded-[22px] p-5 text-white shadow-lg shadow-black/10",
          negative ? "cg-warning-gradient" : "cg-brand-gradient"
        )}
      >
        {/* Halos décoratifs (z positif faible — compat vieux WebView Sunmi). */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-12 -right-10 size-44 rounded-full bg-white/10 blur-2xl"
        />
        <div className="relative z-10">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold tracking-wide backdrop-blur-sm">
            <Wallet className="size-3.5" /> Coligo Pay
          </span>

          <p className="mt-4 text-[11px] font-medium tracking-wider text-white/75 uppercase">
            {negative
              ? "Vous devez à Coligo"
              : balance > 0
                ? "Coligo vous doit"
                : "Solde"}
          </p>
          <p className="text-[2.4rem] leading-none font-extrabold tracking-tight tabular-nums">
            {formatDA(Math.abs(balance))}
          </p>

          {/* UNE seule ligne de contexte, seulement si elle AJOUTE une info. */}
          {negative ? (
            <p className="mt-2 text-[12.5px] text-white/85">
              Commission de vos ventes <strong>espèces</strong> — rechargez pour
              régulariser.
            </p>
          ) : summary.reserved > 0 ? (
            <p className="mt-2 text-[12.5px] text-white/85">
              dont <strong>{formatDA(summary.reserved)}</strong> déjà en cours
              de versement.
            </p>
          ) : balance === 0 ? (
            <p className="mt-2 text-[12.5px] text-white/85">
              Tout est à jour — aucun montant en attente, aucune dette.
            </p>
          ) : null}

          {/* Actions découlant du chiffre (sans le répéter). */}
          <div className="mt-4 flex gap-2">
            {canWithdraw && (
              <button
                type="button"
                onClick={() => setPayoutOpen(true)}
                className="text-primary-700 inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-[14px] bg-white text-sm font-bold shadow-sm transition-transform active:scale-[0.98]"
              >
                <Banknote className="size-4" /> Demander mon versement
              </button>
            )}
            <Link
              href="/recharger"
              prefetch
              className={cn(
                "inline-flex h-11 items-center justify-center gap-2 rounded-[14px] text-sm font-bold transition-transform active:scale-[0.98]",
                canWithdraw
                  ? "bg-white/15 px-4 text-white backdrop-blur-sm"
                  : "text-primary-700 flex-1 bg-white shadow-sm"
              )}
            >
              <Wallet className="size-4" /> Recharger
            </Link>
          </div>
        </div>
      </section>

      {payoutOpen && (
        <PayoutForm
          available={summary.available}
          onClose={() => setPayoutOpen(false)}
        />
      )}
      <CashDebtBanner status={cashDebt} />
      <NextPayoutBanner info={nextPayout} />
    </div>
  );
}

/* ─────────────────────── DETTE ESPÈCES ─────────────────────── */

/**
 * Politique de dette espèces (mig 0269) : prévient au seuil doux, signale le
 * blocage des nouvelles ventes espèces au plafond. Les ventes en ligne restent
 * possibles et réduisent la dette → on pousse vers la recharge.
 */
function CashDebtBanner({ status }: { status: CashDebtStatus }) {
  if (status.state === "clear") return null;

  const blocked = status.state === "blocked";
  return (
    <section
      className={cn(
        "flex items-start gap-3 rounded-[14px] border p-4",
        blocked
          ? "border-danger-100 bg-danger-50"
          : "border-warning-100 bg-warning-50"
      )}
    >
      <AlertTriangle
        className={cn(
          "mt-0.5 size-5 shrink-0",
          blocked ? "text-danger-600" : "text-warning-600"
        )}
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-bold",
            blocked ? "text-danger-700" : "text-warning-700"
          )}
        >
          {blocked
            ? "Ventes en espèces suspendues — plafond atteint"
            : "Vous approchez du plafond de dette espèces"}
        </p>
        <p
          className={cn(
            "mt-1 text-xs",
            blocked ? "text-danger-700" : "text-warning-700"
          )}
        >
          Dette : <strong>{formatDA(status.debt)}</strong> / plafond{" "}
          {formatDA(status.cap)}.{" "}
          {blocked ? (
            <>
              Les ventes <strong>en ligne restent possibles</strong> et
              réduisent votre dette — ou <strong>rechargez</strong> pour
              rétablir tout de suite.
            </>
          ) : (
            <>
              Encore {formatDA(status.remaining)} avant le blocage. Encaissez en
              ligne ou rechargez pour rester serein.
            </>
          )}
        </p>
        <Link
          href="/recharger"
          prefetch
          className={cn(
            "mt-3 inline-flex h-9 items-center gap-2 rounded-[10px] px-4 text-xs font-bold text-white",
            blocked ? "bg-danger-600" : "bg-warning-600"
          )}
        >
          <Wallet className="size-4" /> Recharger maintenant
        </Link>
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
        className="border-border bg-surface text-muted hover:bg-surface-2 flex items-center gap-2.5 rounded-[14px] border px-4 py-3 text-sm transition-colors"
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
      <div className="border-warning-100 bg-warning-50 text-warning-700 flex items-center gap-2.5 rounded-[14px] border px-4 py-3 text-sm">
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
        className="border-warning-100 bg-warning-50 text-warning-700 hover:bg-warning-100 flex items-center gap-2.5 rounded-[14px] border px-4 py-3 text-sm transition-colors"
      >
        <CalendarClock className="size-4 shrink-0" />
        <span>
          Versement {cadenceLabel(info.cadence)} activé —{" "}
          <strong>renseignez vos coordonnées</strong> pour le déclencher.
        </span>
      </Link>
    );
  }

  if (info.kind === "waiting_balance") {
    return (
      <div className="border-border bg-surface text-muted flex items-center gap-2.5 rounded-[14px] border px-4 py-3 text-sm">
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
    <div className="border-primary-100 bg-primary-50/70 flex items-center gap-3 rounded-[14px] border px-4 py-3">
      <div className="bg-primary-100 text-primary-700 grid size-9 shrink-0 place-items-center rounded-full">
        <CalendarClock className="size-5" />
      </div>
      <div className="min-w-0 text-sm">
        <p className="text-primary-700/70 text-xs font-medium">
          Prochain virement automatique ({cadenceLabel(info.cadence)})
        </p>
        {/* Pas de re-citation du montant (déjà UNE fois dans la carte). */}
        <p className="text-foreground font-semibold capitalize">{when}</p>
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
    <>
      <p className="text-subtle mb-3 text-[11px]">
        vert = pour vous · rouge = part Coligo
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
        <span className="text-sm font-bold">
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
    </>
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
    <div className="flex items-start justify-between gap-3 py-2.5">
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
    <ul className="divide-border divide-y">
      {adjustments.map((a) => {
        const positive = a.amount_da >= 0;
        return (
          <li key={a.id} className="flex items-start gap-3 py-2.5">
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
  );
}

/* ─────────────────────────── FACTURES ─────────────────────────── */

function Invoices({ months }: { months: InvoiceMonth[] }) {
  if (months.length === 0) return null;
  return (
    <>
      {/* Export comptable de TOUTES les opérations. <a> car la route renvoie
          un fichier (Content-Disposition) → laisser le navigateur télécharger. */}
      <div className="mb-3 flex justify-end">
        <a
          href="/finances/export"
          className="border-border bg-surface-2 text-foreground hover:bg-surface-3 inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-xs font-semibold transition-colors"
        >
          <FileSpreadsheet className="size-3.5" />
          Exporter tout (CSV)
        </a>
      </div>
      <ul className="divide-border divide-y">
        {months.map((m) => (
          <li
            key={m.key}
            className="flex items-center justify-between gap-3 py-2.5"
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
                className="border-border bg-surface-2 text-foreground hover:bg-surface-3 inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-xs font-semibold transition-colors"
              >
                <Download className="size-3.5" />
                PDF
              </Link>
              <a
                href={`/finances/export?month=${m.key}`}
                className="border-border bg-surface-2 text-foreground hover:bg-surface-3 inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-xs font-semibold transition-colors"
              >
                <FileSpreadsheet className="size-3.5" />
                CSV
              </a>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ─────────────────────── DÉTAILS REPLIÉS ─────────────────────── */

function DeliverySection({ stats }: { stats: DeliveryStats }) {
  if (stats.totalDeliveryOrders === 0) return null;
  return (
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
        tone === "amber" ? "bg-warning-50 text-warning-700" : "bg-surface-2"
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
  page,
  pageCount,
  filters,
}: {
  entries: WalletEntryRow[];
  page: number;
  pageCount: number;
  filters: HistoryFilters;
}) {
  const router = useRouter();
  const [customDates, setCustomDates] = useState(
    Boolean(filters.from && filters.to)
  );
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);

  // Navigation par l'URL (mêmes conventions que Coligo Pay) : la pagination
  // serveur reste JUSTE avec les filtres, et l'état est partageable/traçable.
  const navigate = (next: Partial<HistoryFilters>) => {
    const q = new URLSearchParams();
    const type = next.type ?? filters.type;
    const month = next.month ?? filters.month;
    const f = next.from ?? (customDates ? from : "");
    const t = next.to ?? (customDates ? to : "");
    if (type) q.set("type", type);
    if (month) q.set("month", month);
    else if (f && t) {
      q.set("from", f);
      q.set("to", t);
    }
    const qs = q.toString();
    router.push(qs ? `/finances?${qs}` : "/finances");
  };
  const qsFor = (p: number) => {
    const q = new URLSearchParams();
    if (filters.type) q.set("type", filters.type);
    if (filters.month) q.set("month", filters.month);
    else if (filters.from && filters.to) {
      q.set("from", filters.from);
      q.set("to", filters.to);
    }
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return qs ? `/finances?${qs}` : "/finances";
  };

  const selClass =
    "border-border-strong bg-surface h-10 rounded-[10px] border px-2.5 text-xs focus-visible:outline-none";

  return (
    // -m-4 : annule le padding de l'accordéon pour une liste bord à bord (les
    // lignes gardent leur propre px-4), avec pagination collée en bas.
    <div className="-m-4">
      {/* Filtres : type d'écriture + mois / dates personnalisées. */}
      <div className="border-border flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <select
          value={filters.type}
          onChange={(e) => navigate({ type: e.target.value })}
          className={selClass}
          aria-label="Type d'opération"
        >
          <option value="">Tous les types</option>
          {Object.entries(WALLET_ENTRY_META).map(([k, m]) => (
            <option key={k} value={k}>
              {m.label}
            </option>
          ))}
        </select>
        <input
          type="month"
          value={filters.month}
          onChange={(e) => {
            setCustomDates(false);
            navigate({ month: e.target.value, from: "", to: "" });
          }}
          className={selClass}
          aria-label="Mois"
        />
        <button
          type="button"
          onClick={() => setCustomDates((v) => !v)}
          className={cn(
            "h-10 rounded-[10px] border px-2.5 text-xs font-semibold",
            customDates
              ? "border-primary-400 bg-primary-50 text-primary-700"
              : "border-border-strong bg-surface text-muted"
          )}
        >
          Dates libres
        </button>
        {customDates && (
          <>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={selClass}
              aria-label="Du"
            />
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={selClass}
              aria-label="Au"
            />
            <button
              type="button"
              disabled={!from || !to || from > to}
              onClick={() => navigate({ month: "", from, to })}
              className="bg-primary-600 h-10 rounded-[10px] px-3 text-xs font-bold text-white disabled:opacity-50"
            >
              Appliquer
            </button>
          </>
        )}
        {filters.active && (
          <Link
            href="/finances"
            className="text-primary-700 text-xs font-semibold hover:underline"
          >
            Réinitialiser
          </Link>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="text-muted px-4 py-6 text-center text-sm">
          {filters.active
            ? "Aucune opération pour ces filtres."
            : "Aucune opération pour le moment. Vos gains apparaîtront ici dès qu'une commande sera récupérée."}
        </p>
      ) : (
        <ul className="divide-border divide-y">
          {entries.map((e) => (
            <EntryRow key={e.id} entry={e} />
          ))}
        </ul>
      )}
      {pageCount > 1 && (
        <div className="border-border border-t px-4 py-3">
          <Pagination page={page} pageCount={pageCount} hrefFor={qsFor} />
        </div>
      )}
    </div>
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
    <li className="flex items-center gap-3 px-4 py-3">
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

/** Formulaire de versement — CONTRÔLÉ par la carte (bouton dans la carte). */
function PayoutForm({
  available,
  onClose,
}: {
  available: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState(
    requestPayout,
    initialState
  );

  useEffect(() => {
    if (state.ok) {
      toast.success("Demande de versement envoyée");
      formRef.current?.reset();
      onClose();
      router.refresh();
    }
  }, [state, router, onClose]);

  return (
    <section className="border-border bg-surface rounded-[16px] border p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Banknote className="text-primary-500 size-4" />
        Demander mon versement
      </h2>
      <p className="text-muted mt-0.5 mb-3 text-xs">
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
            onClick={onClose}
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
  );
}
