import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  KeyRound,
  Lock,
  Mail,
  Phone,
  QrCode,
  Send,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { formatDA } from "@/lib/utils";
import type {
  ColigoPayAuditEntry,
  ColigoPayOverview,
  SecurityEvent,
} from "@/lib/data/coligo-pay-admin";

// =============================================================================
// ColigoPaySurveillance — vue admin : réconciliation + journal d'audit Coligo Pay.
// Lecture seule (super-admin). « Tout réconcilié » = tous les contrôles à 0.
// =============================================================================

function dt(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-DZ", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const KIND_META: Record<
  ColigoPayAuditEntry["kind"],
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    cls: string;
  }
> = {
  payment: {
    label: "Paiement marchand",
    icon: QrCode,
    cls: "bg-primary-50 text-primary-700",
  },
  transfer: {
    label: "Transfert P2P",
    icon: ArrowLeftRight,
    cls: "bg-warning-100 text-warning-700",
  },
  recharge: {
    label: "Recharge",
    icon: Wallet,
    cls: "bg-success-50 text-success-700",
  },
};

const EVENT_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  pin_set: { label: "PIN créé", icon: KeyRound },
  pin_changed: { label: "PIN modifié", icon: KeyRound },
  email_changed: { label: "Email modifié", icon: Mail },
  phone_changed: { label: "Téléphone modifié", icon: Phone },
};

export function ColigoPaySurveillance({
  overview,
  audit,
  events,
}: {
  overview: ColigoPayOverview | null;
  audit: ColigoPayAuditEntry[];
  events: SecurityEvent[];
}) {
  if (!overview) {
    return (
      <div className="mx-auto max-w-[1100px] p-6">
        <p className="text-muted text-sm">
          Données indisponibles (accès super-admin requis).
        </p>
      </div>
    );
  }

  const anomalies =
    overview.negativeBalances +
    overview.unbalancedPayments +
    overview.unbalancedTransfers;
  const healthy = anomalies === 0;

  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight lg:text-3xl">
          <Wallet className="text-primary-600 size-7" />
          Coligo Pay — Surveillance
        </h1>
        <p className="text-muted mt-1 text-sm">
          Réconciliation au dinar près et journal d&apos;audit de tous les
          mouvements (recharges, paiements, transferts).
        </p>
      </header>

      {/* Bandeau de réconciliation / intégrité */}
      <section
        className={
          healthy
            ? "border-success-200 bg-success-50 mb-6 rounded-lg border p-5"
            : "border-danger-200 bg-danger-50 mb-6 rounded-lg border p-5"
        }
      >
        <div className="flex items-center gap-3">
          {healthy ? (
            <CheckCircle2 className="text-success-600 size-6 shrink-0" />
          ) : (
            <AlertTriangle className="text-danger-600 size-6 shrink-0 animate-pulse" />
          )}
          <div>
            <p
              className={
                healthy
                  ? "text-success-800 font-semibold"
                  : "text-danger-800 font-semibold"
              }
            >
              {healthy
                ? "Comptes réconciliés — aucune anomalie"
                : `${anomalies} anomalie(s) détectée(s) — action requise`}
            </p>
            <p
              className={
                healthy
                  ? "text-success-700/80 text-xs"
                  : "text-danger-700/80 text-xs"
              }
            >
              Double-entrée vérifiée : chaque dinar entré = sorti. Aucun solde
              ne doit être négatif.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Integrity
            label="Soldes négatifs"
            value={overview.negativeBalances}
          />
          <Integrity
            label="Paiements déséquilibrés"
            value={overview.unbalancedPayments}
          />
          <Integrity
            label="Transferts déséquilibrés"
            value={overview.unbalancedTransfers}
          />
          <Integrity
            label="PIN verrouillés (en cours)"
            value={overview.pinLockedNow}
            warnOnly
            icon={Lock}
          />
        </div>
      </section>

      {/* Cartes de circulation / flux */}
      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <BigCard
          label="Coligo Pay en circulation"
          sub={`${overview.accountsWithBalance} compte(s) avec solde`}
          value={formatDA(overview.circulationDa)}
          icon={Wallet}
          highlight
        />
        <Card
          label="Recharges (Chargily)"
          value={formatDA(overview.rechargesDa)}
          sub={`${overview.rechargesCount} recharge(s)`}
          icon={Wallet}
        />
        <Card
          label="Paiements marchand"
          value={formatDA(overview.merchantPaymentsDa)}
          sub={`${overview.merchantPaymentsCount} · commission ${formatDA(
            overview.merchantPaymentsCommissionDa
          )}`}
          icon={QrCode}
        />
        <Card
          label="Transferts entre amis"
          value={formatDA(overview.transfersDa)}
          sub={`${overview.transfersCount} transfert(s)`}
          icon={Send}
        />
      </section>

      {/* Journal d'audit */}
      <section
        data-alert-focus="paid_after_cancel"
        className="border-border bg-surface rounded-lg border"
      >
        <header className="border-border flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">Journal d&apos;audit</h2>
          <span className="text-muted text-xs tabular-nums">
            {audit.length} mouvement(s)
          </span>
        </header>
        {audit.length === 0 ? (
          <p className="text-muted px-5 py-10 text-center text-sm">
            Aucun mouvement pour le moment.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {audit.map((e, i) => {
              const meta = KIND_META[e.kind];
              const Icon = meta.icon;
              return (
                <li
                  key={`${e.ref ?? "x"}-${i}`}
                  className="flex items-center gap-3 px-5 py-3"
                >
                  <span
                    className={`rounded-control grid size-9 shrink-0 place-items-center ${meta.cls}`}
                  >
                    <Icon className="size-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {meta.label}
                      {e.kind === "payment" && e.commissionDa > 0 && (
                        <span className="text-muted font-normal">
                          {" "}
                          · comm. {formatDA(e.commissionDa)}
                        </span>
                      )}
                    </p>
                    <p className="text-subtle truncate text-xs">
                      {e.fromName ? e.fromName : "—"} →{" "}
                      {e.toName ? e.toName : "—"} · {dt(e.at)}
                    </p>
                  </div>
                  <span className="text-foreground shrink-0 text-sm font-semibold tabular-nums">
                    {formatDA(e.amountDa)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Journal des actions sensibles (PIN, email, téléphone) */}
      <section className="border-border bg-surface mt-6 rounded-lg border">
        <header className="border-border flex items-center justify-between border-b px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <ShieldCheck className="text-primary-600 size-4" />
            Actions sensibles
          </h2>
          <span className="text-muted text-xs tabular-nums">
            {events.length} action(s)
          </span>
        </header>
        {events.length === 0 ? (
          <p className="text-muted px-5 py-8 text-center text-sm">
            Aucune action sensible enregistrée.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {events.map((e, i) => {
              const meta = EVENT_META[e.event] ?? {
                label: e.event,
                icon: ShieldCheck,
              };
              const Icon = meta.icon;
              return (
                <li
                  key={`${e.at}-${i}`}
                  className="flex items-center gap-3 px-5 py-3"
                >
                  <span className="bg-surface-2 text-muted rounded-control grid size-9 shrink-0 place-items-center">
                    <Icon className="size-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {meta.label}
                    </p>
                    <p className="text-subtle truncate text-xs">
                      {e.who ?? "—"} · {dt(e.at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Integrity({
  label,
  value,
  warnOnly,
  icon: Icon,
}: {
  label: string;
  value: number;
  warnOnly?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const bad = value > 0 && !warnOnly;
  return (
    <div className="bg-surface/70 rounded-md px-3 py-2.5">
      <p className="text-muted text-caption flex items-center gap-1 font-medium">
        {Icon && <Icon className="size-3" />}
        {label}
      </p>
      <p
        className={
          bad
            ? "text-danger-700 text-lg font-bold tabular-nums"
            : "text-foreground text-lg font-bold tabular-nums"
        }
      >
        {value}
      </p>
    </div>
  );
}

function BigCard({
  label,
  value,
  sub,
  icon: Icon,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        highlight
          ? "border-primary-200 from-primary-600 to-primary-700 rounded-lg border bg-gradient-to-br p-5 text-white"
          : "border-border bg-surface rounded-lg border p-5"
      }
    >
      <div
        className={
          highlight
            ? "flex items-center gap-2 text-sm font-medium text-white/80"
            : "text-muted flex items-center gap-2 text-sm font-medium"
        }
      >
        <Icon className="size-4" />
        {label}
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight tabular-nums">
        {value}
      </p>
      {sub && (
        <p
          className={
            highlight ? "mt-1 text-xs text-white/75" : "text-muted mt-1 text-xs"
          }
        >
          {sub}
        </p>
      )}
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="border-border bg-surface rounded-lg border p-5">
      <div className="text-muted mb-2 flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
        <Icon className="text-primary-500 size-4" />
      </div>
      <p className="text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      {sub && <p className="text-subtle mt-1 text-xs">{sub}</p>}
    </div>
  );
}
