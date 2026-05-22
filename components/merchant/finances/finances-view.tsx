"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Loader2,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { cn, formatDA } from "@/lib/utils";
import {
  PAYOUT_METHODS,
  PAYOUT_STATUS_META,
  WALLET_ENTRY_META,
  type PayoutRequest,
  type WalletEntry,
} from "@/lib/types";
import {
  requestPayout,
  type PayoutFormState,
} from "@/app/(merchant)/finances/actions";
import type { FinancesSummary } from "@/app/(merchant)/finances/page";

const initialState: PayoutFormState = {};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-DZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function FinancesView({
  entries,
  requests,
  summary,
}: {
  entries: WalletEntry[];
  requests: PayoutRequest[];
  summary: FinancesSummary;
}) {
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <header className="mb-5 lg:mb-6">
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
          Finances
        </h1>
        <p className="text-muted mt-1 text-sm">
          Votre solde, vos gains et vos demandes de versement.
        </p>
      </header>

      {/* Solde */}
      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="border-primary-200 from-primary-600 to-primary-700 rounded-[16px] border bg-gradient-to-br p-5 text-white shadow-sm lg:col-span-1">
          <div className="flex items-center gap-2 text-sm font-medium text-white/80">
            <Wallet className="size-4" />
            Solde disponible
          </div>
          <p className="mt-2 text-3xl font-bold tracking-tight tabular-nums">
            {formatDA(summary.available)}
          </p>
          {summary.reserved > 0 && (
            <p className="mt-1 text-xs text-white/75">
              {formatDA(summary.reserved)} en cours de versement
            </p>
          )}
        </div>

        <StatCard
          label="Total des ventes"
          value={formatDA(summary.totalSales)}
          icon={ArrowUpRight}
          tone="success"
        />
        <StatCard
          label="Commissions Coligo"
          value={formatDA(summary.totalCommission)}
          icon={ArrowDownRight}
          tone="danger"
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* Historique des écritures */}
        <section className="border-border bg-surface rounded-[16px] border">
          <header className="border-border border-b px-5 py-4">
            <h2 className="text-base font-semibold">Historique</h2>
          </header>
          {entries.length === 0 ? (
            <p className="text-muted px-5 py-10 text-center text-sm">
              Aucune écriture pour le moment. Vos gains apparaîtront ici dès
              qu&apos;une commande sera récupérée.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {entries.map((e) => (
                <EntryRow key={e.id} entry={e} />
              ))}
            </ul>
          )}
        </section>

        {/* Colonne droite : demande + liste des demandes */}
        <div className="space-y-5">
          <PayoutForm available={summary.available} />
          <PayoutList requests={requests} />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "success" | "danger";
}) {
  return (
    <div className="border-border bg-surface rounded-[16px] border p-5 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-muted text-xs font-medium">{label}</span>
        <Icon
          className={cn(
            "size-4",
            tone === "success" ? "text-success-600" : "text-danger-500"
          )}
        />
      </div>
      <div className="text-2xl font-bold tracking-tight tabular-nums">
        {value}
      </div>
    </div>
  );
}

function EntryRow({ entry }: { entry: WalletEntry }) {
  const meta = WALLET_ENTRY_META[entry.type];
  const positive = entry.amount_da >= 0;
  return (
    <li className="flex items-center gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge tone={meta.tone}>{meta.label}</Badge>
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
  const [state, formAction, pending] = useActionState(
    requestPayout,
    initialState
  );

  useEffect(() => {
    if (state.ok) {
      toast.success("Demande de versement envoyée");
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  const disabled = available <= 0;

  return (
    <section className="border-border bg-surface rounded-[16px] border p-5">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
        <Banknote className="text-primary-500 size-4" />
        Demander un versement
      </h2>
      <p className="text-muted mb-4 text-xs">
        Disponible : {formatDA(Math.max(0, available))}
      </p>

      {disabled ? (
        <p className="text-muted bg-surface-3 rounded-[12px] px-4 py-3 text-sm">
          Aucun solde disponible pour l&apos;instant.
        </p>
      ) : (
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              Montant (DA)<span className="text-rose-600"> *</span>
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
                  if (amountRef.current) {
                    amountRef.current.value = String(available);
                  }
                }}
                disabled={pending}
                className="text-primary-700 absolute top-1/2 right-3 -translate-y-1/2 text-xs font-semibold hover:underline"
              >
                Max
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Méthode</Label>
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
              Coordonnées (n° CCP / RIB)
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

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Banknote className="size-4" />
            )}
            Envoyer la demande
          </Button>
        </form>
      )}
    </section>
  );
}

function PayoutList({ requests }: { requests: PayoutRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <section className="border-border bg-surface rounded-[16px] border p-5">
      <h2 className="mb-3 text-base font-semibold">Mes demandes</h2>
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
