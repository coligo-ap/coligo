"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  Loader2,
  Search,
  Settings2,
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
} from "@/lib/types";
import { PERIOD_OPTIONS, type PeriodKey } from "@/lib/finances/period";
import {
  requestPayout,
  type PayoutFormState,
} from "@/app/(merchant)/finances/actions";
import type { WalletEntryRow } from "@/lib/data/wallet";
import type { PayoutHistoryItem } from "@/lib/data/payout-statements";
import type { NextPayout } from "@/lib/finances/next-payout";
import type { CashDebtStatus } from "@/lib/finances/cash-debt";
import type { FinancesSummary } from "@/app/(merchant)/finances/page";

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
  /** Recherche libre (n° commande, note, n° facture…). */
  q: string;
  period: PeriodKey;
  from: string;
  to: string;
  /** Vrai si l'utilisateur a dévié des défauts (type/recherche/période). */
  active: boolean;
};

export function FinancesView({
  entries,
  historyFilters,
  payouts,
  payoutsTotal,
  vpage,
  vpageCount,
  hasAnyPayout,
  summary,
  page,
  pageCount,
  total,
  coligoPayBalance,
  nextPayout,
  cashDebt,
  owedByDriversDa,
  exportQs,
}: {
  entries: WalletEntryRow[];
  historyFilters: HistoryFilters;
  /** Page de versements (période + recherche appliquées côté serveur). */
  payouts: PayoutHistoryItem[];
  /** Total de versements après filtres (pour la pastille + pagination). */
  payoutsTotal: number;
  vpage: number;
  vpageCount: number;
  /** Vrai si le commerçant a au moins une demande, toutes périodes confondues. */
  hasAnyPayout: boolean;
  summary: FinancesSummary;
  page: number;
  pageCount: number;
  total: number;
  coligoPayBalance: number;
  nextPayout: NextPayout;
  cashDebt: CashDebtStatus;
  /** Avances COD reçues des livreurs (payées en main propre au retrait). */
  owedByDriversDa: number;
  /** Query string (from/to ISO) des exports PDF/CSV de la période courante. */
  exportQs: string;
}) {
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
          + les actions (versement / recharge). */}
      <EssentialMoney
        balance={coligoPayBalance}
        summary={summary}
        cashDebt={cashDebt}
        nextPayout={nextPayout}
      />

      {/* ════════════════ LE MODULE PAIEMENTS (unique) ════════════════
          Versements + opérations dans UNE carte, sous UN filtre de période.
          Chaque versement payé porte ses documents (facture résumé PDF,
          détail PDF/CSV) — plus de sections séparées à déplier. */}
      <PaymentsModule
        payouts={payouts}
        payoutsTotal={payoutsTotal}
        vpage={vpage}
        vpageCount={vpageCount}
        hasAnyPayout={hasAnyPayout}
        entries={entries}
        filters={historyFilters}
        page={page}
        pageCount={pageCount}
        total={total}
        owedByDriversDa={owedByDriversDa}
        exportQs={exportQs}
      />
    </div>
  );
}

/* ─────────────── L'ESSENTIEL : UNE carte, UN chiffre, LES actions ─────────────── */

/**
 * Pour un commerçant, solde Coligo Pay ≡ « Coligo vous doit » (positif) ou
 * « Vous devez à Coligo » (négatif) : c'est UNE information — elle n'apparaît
 * donc qu'UNE fois, dans cette carte, avec les actions qui en découlent
 * (demander le versement / recharger).
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

/* ════════════════════════ MODULE PAIEMENTS (unique) ════════════════════════ */

type Tab = "versements" | "operations";

/**
 * LE module financier : deux onglets (Versements = liste principale,
 * Opérations = grand livre filtrable) sous UN filtre de période partagé
 * (défaut « Ce mois »). Ultra compact : tout est bord à bord dans une carte,
 * les documents d'un versement (facture PDF résumé / détail PDF / CSV)
 * s'ouvrent depuis sa ligne.
 */
function PaymentsModule({
  payouts,
  payoutsTotal,
  vpage,
  vpageCount,
  hasAnyPayout,
  entries,
  filters,
  page,
  pageCount,
  total,
  owedByDriversDa,
  exportQs,
}: {
  payouts: PayoutHistoryItem[];
  payoutsTotal: number;
  vpage: number;
  vpageCount: number;
  hasAnyPayout: boolean;
  entries: WalletEntryRow[];
  filters: HistoryFilters;
  page: number;
  pageCount: number;
  total: number;
  owedByDriversDa: number;
  exportQs: string;
}) {
  const router = useRouter();
  // Un filtre d'opérations ou une pagination dans l'URL ⇒ l'utilisateur
  // travaillait sur l'onglet Opérations : on l'y ramène.
  const [tab, setTab] = useState<Tab>(
    filters.type || page > 1 ? "operations" : "versements"
  );
  const [customOpen, setCustomOpen] = useState(filters.period === "custom");
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [qInput, setQInput] = useState(filters.q);

  // Query string commune (période + type + recherche) ± pages courantes.
  const baseQs = (next: Partial<HistoryFilters> = {}) => {
    const q = new URLSearchParams();
    const period = next.period ?? filters.period;
    if (period !== "month") q.set("period", period);
    if (period === "custom") {
      q.set("from", next.from ?? filters.from);
      q.set("to", next.to ?? filters.to);
    }
    const type = next.type ?? filters.type;
    if (type) q.set("type", type);
    const search = (next.q ?? filters.q).trim();
    if (search) q.set("q", search);
    return q;
  };
  // Navigation par l'URL (état partageable, pagination serveur juste). Tout
  // changement de filtre REPART en page 1 (les deux paginations).
  const navigate = (next: Partial<HistoryFilters>) => {
    const qs = baseQs(next).toString();
    router.push(qs ? `/finances?${qs}` : "/finances");
  };
  // hrefs de pagination : chaque onglet garde la page de l'autre.
  const qsFor = (p: number) => {
    const q = baseQs();
    if (vpage > 1) q.set("vpage", String(vpage));
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return qs ? `/finances?${qs}` : "/finances";
  };
  const vqsFor = (p: number) => {
    const q = baseQs();
    if (page > 1) q.set("page", String(page));
    if (p > 1) q.set("vpage", String(p));
    const qs = q.toString();
    return qs ? `/finances?${qs}` : "/finances";
  };

  // Recherche débouncée → URL (le serveur filtre versements ET opérations).
  useEffect(() => {
    if (qInput === filters.q) return;
    const t = setTimeout(() => navigate({ q: qInput }), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate recréée à chaque render
  }, [qInput, filters.q]);
  // Re-synchronise l'input quand l'URL change ailleurs (« Réinitialiser »).
  useEffect(() => {
    setQInput(filters.q);
  }, [filters.q]);

  const selClass =
    "border-border-strong bg-surface h-9 rounded-[10px] border px-2.5 text-xs focus-visible:outline-none";

  return (
    <section className="border-border bg-surface mt-4 overflow-hidden rounded-[16px] border">
      {/* ── En-tête : onglets + période ── */}
      <div className="border-border flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
        <div className="bg-surface-2 flex rounded-full p-0.5" role="tablist">
          <TabButton
            active={tab === "versements"}
            onClick={() => setTab("versements")}
            label="Versements"
            count={payoutsTotal}
          />
          <TabButton
            active={tab === "operations"}
            onClick={() => setTab("operations")}
            label="Opérations"
            count={total}
          />
        </div>
        <div className="ml-auto">
          <select
            value={filters.period}
            onChange={(e) => {
              const v = e.target.value as PeriodKey;
              if (v === "custom") setCustomOpen(true);
              else {
                setCustomOpen(false);
                navigate({ period: v });
              }
            }}
            className={selClass}
            aria-label="Période"
          >
            {PERIOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Recherche + téléchargements (EN HAUT du module) ── */}
      <div className="border-border flex items-center gap-2 border-b px-3 py-2.5">
        <div className="relative min-w-0 flex-1">
          <Search className="text-subtle pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Rechercher (commande, note, facture…)"
            aria-label="Rechercher"
            className="border-border-strong bg-surface h-9 w-full rounded-[10px] border pr-2.5 pl-8 text-xs focus-visible:outline-none"
          />
        </div>
        {/* <a> : routes fichiers (PDF inline / CSV téléchargé). */}
        <a
          href={`/api/pdf/releve-commercant?${exportQs}`}
          target="_blank"
          rel="noopener"
          className="border-border bg-surface-2 text-foreground hover:bg-surface-3 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border px-2.5 text-xs font-semibold transition-colors"
        >
          <FileText className="size-3.5" />
          PDF
        </a>
        <a
          href={`/finances/export?${exportQs}`}
          className="border-border bg-surface-2 text-foreground hover:bg-surface-3 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border px-2.5 text-xs font-semibold transition-colors"
        >
          <FileSpreadsheet className="size-3.5" />
          CSV
        </a>
      </div>

      {/* ── Dates libres (période personnalisée) ── */}
      {customOpen && (
        <div className="border-border flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={selClass}
            aria-label="Date de début"
          />
          <span className="text-subtle text-xs">au</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={selClass}
            aria-label="Date de fin"
          />
          <button
            type="button"
            disabled={!from || !to || from > to}
            onClick={() => navigate({ period: "custom", from, to })}
            className="bg-primary-600 h-9 rounded-[10px] px-3 text-xs font-bold text-white disabled:opacity-50"
          >
            Appliquer
          </button>
        </div>
      )}

      {/* ── Contenu de l'onglet ── */}
      {tab === "versements" ? (
        <PayoutHistory
          payouts={payouts}
          hasAnyPayout={hasAnyPayout}
          searching={Boolean(filters.q)}
          vpage={vpage}
          vpageCount={vpageCount}
          hrefFor={vqsFor}
        />
      ) : (
        <Operations
          entries={entries}
          filters={filters}
          page={page}
          pageCount={pageCount}
          qsFor={qsFor}
          onType={(type) => navigate({ type })}
        />
      )}

      {/* ── Pied : info livraison (seulement si elle apporte une info) ── */}
      {owedByDriversDa > 0 && (
        <div className="border-border bg-surface-2/50 border-t px-4 py-2.5">
          <span className="text-subtle text-xs">
            Avances COD reçues des livreurs :{" "}
            <strong className="text-foreground">
              {formatDA(owedByDriversDa)}
            </strong>
          </span>
        </div>
      )}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
        active ? "bg-surface text-foreground shadow-sm" : "text-muted"
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums",
          active ? "bg-primary-50 text-primary-700" : "bg-surface-3 text-muted"
        )}
      >
        {count}
      </span>
    </button>
  );
}

/* ─────────────────────── ONGLET VERSEMENTS ─────────────────────── */

/**
 * Liste principale : un versement par ligne (date · commandes · montant ·
 * statut). Une ligne PAYÉE se déplie sur ses documents : facture PDF résumé
 * (défaut), facture détaillée PDF et CSV — générés serveur (pdf-lib), jamais
 * window.print.
 */
function PayoutHistory({
  payouts,
  hasAnyPayout,
  searching,
  vpage,
  vpageCount,
  hrefFor,
}: {
  payouts: PayoutHistoryItem[];
  hasAnyPayout: boolean;
  searching: boolean;
  vpage: number;
  vpageCount: number;
  hrefFor: (p: number) => string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (payouts.length === 0) {
    return (
      <p className="text-muted px-4 py-8 text-center text-sm">
        {searching
          ? "Aucun versement ne correspond à votre recherche."
          : hasAnyPayout
            ? "Aucun versement sur cette période — élargissez la période pour retrouver les précédents."
            : "Vos versements apparaîtront ici, avec leur facture à télécharger. Demandez-en un depuis la carte ci-dessus, ou activez le versement automatique."}
      </p>
    );
  }

  return (
    <>
      <ul className="divide-border divide-y">
        {payouts.map((p) => {
          const paid = p.status === "paid";
          const meta = PAYOUT_STATUS_META[p.status];
          const open = openId === p.id;
          const when = paid && p.periodTo ? p.periodTo : p.created_at;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : p.id)}
                aria-expanded={open}
                className="hover:bg-surface-2 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
              >
                <span className="bg-primary-50 text-primary-600 grid size-9 shrink-0 place-items-center rounded-full">
                  <Banknote className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {formatDate(when)}
                  </span>
                  <span className="text-subtle mt-0.5 block text-xs">
                    {paid
                      ? `${p.ordersCount} commande${p.ordersCount > 1 ? "s" : ""} · ${p.invoiceNumber}`
                      : `Demande du ${formatDate(p.created_at)} · ${p.method.toUpperCase()}`}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-bold tabular-nums">
                    {formatDA(p.amount_da)}
                  </span>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </span>
                <ChevronDown
                  className={cn(
                    "text-muted size-4 shrink-0 transition-transform",
                    open && "rotate-180"
                  )}
                />
              </button>

              {open && (
                <div className="bg-surface-2/50 px-4 pt-1 pb-3">
                  {paid ? (
                    <>
                      <p className="text-subtle mb-2 text-xs">
                        Période couverte :{" "}
                        {p.periodFrom
                          ? `${formatDate(p.periodFrom)} → ${formatDate(p.periodTo!)}`
                          : `jusqu'au ${formatDate(p.periodTo!)}`}{" "}
                        · versé par {p.method.toUpperCase()}
                      </p>
                      {/* <a> : routes fichiers (PDF inline / CSV téléchargé). */}
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={`/api/pdf/versement/${p.id}`}
                          target="_blank"
                          rel="noopener"
                          className="bg-primary-600 inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-bold text-white"
                        >
                          <FileText className="size-3.5" />
                          Facture (PDF)
                        </a>
                        <a
                          href={`/api/pdf/versement/${p.id}?detail=1`}
                          target="_blank"
                          rel="noopener"
                          className="border-border bg-surface text-foreground hover:bg-surface-3 inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-xs font-semibold transition-colors"
                        >
                          <FileText className="size-3.5" />
                          Détail par commande (PDF)
                        </a>
                        <a
                          href={`/finances/versements/${p.id}/export`}
                          className="border-border bg-surface text-foreground hover:bg-surface-3 inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-xs font-semibold transition-colors"
                        >
                          <FileSpreadsheet className="size-3.5" />
                          Détail (CSV)
                        </a>
                      </div>
                    </>
                  ) : (
                    <p className="text-subtle text-xs">
                      {p.status === "pending" &&
                        "Demande en cours de traitement par Coligo — le montant est réservé sur votre solde."}
                      {p.status === "approved" &&
                        "Demande approuvée — le paiement est en préparation."}
                      {p.status === "rejected" &&
                        "Demande refusée — le montant est resté disponible sur votre solde."}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {vpageCount > 1 && (
        <div className="border-border border-t px-4 py-3">
          <Pagination page={vpage} pageCount={vpageCount} hrefFor={hrefFor} />
        </div>
      )}
    </>
  );
}

/* ─────────────────────── ONGLET OPÉRATIONS ─────────────────────── */

/** Grand livre de la période : filtre par type + pagination serveur. */
function Operations({
  entries,
  filters,
  page,
  pageCount,
  qsFor,
  onType,
}: {
  entries: WalletEntryRow[];
  filters: HistoryFilters;
  page: number;
  pageCount: number;
  qsFor: (p: number) => string;
  onType: (type: string) => void;
}) {
  return (
    <div>
      <div className="border-border flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <select
          value={filters.type}
          onChange={(e) => onType(e.target.value)}
          className="border-border-strong bg-surface h-9 rounded-[10px] border px-2.5 text-xs focus-visible:outline-none"
          aria-label="Type d'opération"
        >
          <option value="">Tous les types</option>
          {Object.entries(WALLET_ENTRY_META).map(([k, m]) => (
            <option key={k} value={k}>
              {m.label}
            </option>
          ))}
        </select>
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
        <p className="text-muted px-4 py-8 text-center text-sm">
          Aucune opération sur cette période
          {filters.type ? " pour ce type" : ""}
          {filters.q ? " ne correspond à votre recherche" : ""}.
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
