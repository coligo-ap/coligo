"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  CheckCircle2,
  HandCoins,
  Loader2,
  Wallet,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/ui/confirm";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { cn, formatDA } from "@/lib/utils";
import { PAYOUT_STATUS_META, type PayoutStatus } from "@/lib/types";
import {
  processPayout,
  recordPartnerPayout,
} from "@/app/admin/versements/actions";

export type MerchantPayout = {
  id: string;
  merchantName: string;
  amountDa: number;
  status: PayoutStatus;
  method: string;
  details: string | null;
  createdAt: string;
  processedAt: string | null;
};

export type PartnerPayable = {
  wallet_id: string;
  display_name: string | null;
  owner_name: string | null;
  phone: string | null;
  status: string;
  balance_da: number;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-DZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Algiers",
  });
}

export function PayoutsManager({
  payouts,
  partners,
}: {
  payouts: MerchantPayout[];
  partners: PartnerPayable[];
}) {
  const pending = payouts.filter(
    (p) => p.status === "pending" || p.status === "approved"
  );
  const pendingTotal = pending.reduce((s, p) => s + p.amountDa, 0);

  return (
    <div className="mx-auto max-w-[920px] space-y-6 p-4 lg:p-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight lg:text-2xl">
          Versements
        </h1>
        <p className="text-muted mt-0.5 text-sm">
          Traitez les demandes de versement des commerçants et payez les
          partenaires. « Marquer payée » débite le solde — à faire{" "}
          <strong className="text-foreground">après</strong> le virement réel.
        </p>
      </header>

      {/* Récap rapide */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          label="Demandes à traiter"
          value={String(pending.length)}
          tone="warning"
        />
        <Stat label="Montant en attente" value={formatDA(pendingTotal)} />
        <Stat label="Partenaires" value={String(partners.length)} />
      </div>

      <MerchantPayouts payouts={payouts} />
      <PartnerPayouts partners={partners} />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-card-lg border p-4",
        tone === "warning"
          ? "border-warning-100 bg-warning-50"
          : "border-border bg-surface"
      )}
    >
      <p className="text-muted text-xs font-medium">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

/* ───────────────────────── COMMERÇANTS ───────────────────────── */

export function MerchantPayouts({ payouts }: { payouts: MerchantPayout[] }) {
  const [tab, setTab] = useState<"pending" | "all">("pending");

  const rows = useMemo(
    () =>
      tab === "pending"
        ? payouts.filter(
            (p) => p.status === "pending" || p.status === "approved"
          )
        : payouts,
    [tab, payouts]
  );

  return (
    <section
      data-alert-focus="payouts_pending"
      className="border-border bg-surface rounded-lg border"
    >
      <header className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Banknote className="text-primary-500 size-4" />
          Demandes des commerçants
        </h2>
        <div className="bg-surface-2 rounded-control inline-flex p-0.5 text-xs font-semibold">
          {(["pending", "all"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "rounded-sm px-3 py-1.5 transition-colors",
                tab === t
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted hover:text-foreground"
              )}
            >
              {t === "pending" ? "À traiter" : "Toutes"}
            </button>
          ))}
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="text-muted px-5 py-12 text-center text-sm">
          {tab === "pending"
            ? "Aucune demande en attente. Tout est traité ✅"
            : "Aucune demande de versement pour le moment."}
        </p>
      ) : (
        <ul className="divide-border divide-y">
          {rows.map((p) => (
            <MerchantRow key={p.id} payout={p} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MerchantRow({ payout }: { payout: MerchantPayout }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useActionNote();
  const meta = PAYOUT_STATUS_META[payout.status];
  const open = payout.status === "pending" || payout.status === "approved";

  const run = (action: "approve" | "pay" | "reject") =>
    startTransition(async () => {
      const res = await processPayout(payout.id, action);
      if (res.error) {
        setNote({ ok: false, text: res.error });
        return;
      }
      setNote({
        ok: true,
        text:
          action === "pay"
            ? "Versement marqué payé"
            : action === "approve"
              ? "Demande approuvée"
              : "Demande refusée",
      });
      router.refresh();
    });

  const askPay = async () => {
    const ok = await confirm({
      title: "Marquer ce versement comme payé ?",
      message: `${formatDA(payout.amountDa)} à ${payout.merchantName}. Cela débite son solde Coligo Pay — à confirmer SEULEMENT après le virement réel (${payout.method.toUpperCase()}).`,
      confirmLabel: "Oui, marquer payée",
    });
    if (ok) run("pay");
  };

  const askReject = async () => {
    const ok = await confirm({
      title: "Refuser cette demande ?",
      message: `La demande de ${formatDA(payout.amountDa)} de ${payout.merchantName} sera refusée. Le montant reste disponible sur son solde.`,
      confirmLabel: "Refuser",
      danger: true,
    });
    if (ok) run("reject");
  };

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-semibold">{payout.merchantName}</p>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
        <p className="text-subtle mt-0.5 text-xs">
          {payout.method.toUpperCase()}
          {payout.details ? ` · ${payout.details}` : ""} · demandé le{" "}
          {formatDate(payout.createdAt)}
          {payout.processedAt
            ? ` · traité le ${formatDate(payout.processedAt)}`
            : ""}
        </p>
      </div>

      <p className="text-base font-extrabold tabular-nums">
        {formatDA(payout.amountDa)}
      </p>

      {open && (
        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
          {payout.status === "pending" && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => run("approve")}
            >
              <CheckCircle2 className="size-4" />
              Approuver
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={askReject}
            className="text-danger-600 hover:bg-danger-50"
          >
            <XCircle className="size-4" />
            Refuser
          </Button>
          <Button type="button" size="sm" disabled={pending} onClick={askPay}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Banknote className="size-4" />
            )}
            Marquer payée
          </Button>
        </div>
      )}
      <ActionNote note={note} className="mt-2" />
    </li>
  );
}

/* ───────────────────────── PARTENAIRES ───────────────────────── */

function PartnerPayouts({ partners }: { partners: PartnerPayable[] }) {
  return (
    <section className="border-border bg-surface rounded-lg border">
      <header className="border-border border-b px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <HandCoins className="text-primary-500 size-4" />
          Partenaires (Agents Coligo Pay)
        </h2>
        <p className="text-muted mt-0.5 text-xs">
          Solde = ce que le partenaire détient. « Verser » enregistre un débit
          tracé après votre virement réel.
        </p>
      </header>

      {partners.length === 0 ? (
        <p className="text-muted px-5 py-12 text-center text-sm">
          Aucun partenaire enregistré.
        </p>
      ) : (
        <ul className="divide-border divide-y">
          {partners.map((p) => (
            <PartnerRow key={p.wallet_id} partner={p} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PartnerRow({ partner }: { partner: PartnerPayable }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [fb, setFb] = useActionNote();
  const canPay = partner.balance_da > 0;

  const submit = () =>
    startTransition(async () => {
      const amt = Math.round(Number(amount));
      if (!Number.isFinite(amt) || amt <= 0) {
        setFb({ ok: false, text: "Montant invalide." });
        return;
      }
      const res = await recordPartnerPayout({
        walletId: partner.wallet_id,
        amountDa: amt,
        note: note.trim(),
      });
      if (res.error) {
        setFb({ ok: false, text: res.error });
        return;
      }
      // Succès : le formulaire se ferme (feedback visuel).
      setOpen(false);
      setAmount("");
      setNote("");
      router.refresh();
    });

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {partner.display_name || "Partenaire"}
          </p>
          <p className="text-subtle mt-0.5 text-xs">
            {partner.owner_name ? `${partner.owner_name} · ` : ""}
            {partner.phone ?? "—"}
            {partner.status !== "active" ? ` · ${partner.status}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-subtle text-caption">Solde</p>
          <p
            className={cn(
              "text-base font-extrabold tabular-nums",
              partner.balance_da < 0 ? "text-danger-600" : "text-foreground"
            )}
          >
            {formatDA(partner.balance_da)}
          </p>
        </div>
        <Button
          type="button"
          variant={open ? "secondary" : "default"}
          size="sm"
          disabled={!canPay && !open}
          onClick={() => setOpen((v) => !v)}
        >
          <Wallet className="size-4" />
          {open ? "Fermer" : "Verser"}
        </Button>
      </div>

      {open && (
        <div className="bg-surface-2 mt-3 grid gap-3 rounded-md p-3 sm:grid-cols-[140px_1fr_auto] sm:items-end">
          <div className="space-y-1">
            <label className="text-muted text-xs font-medium">
              Montant (DA)
            </label>
            <Input
              type="number"
              min={1}
              max={partner.balance_da}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={String(partner.balance_da)}
              disabled={pending}
            />
          </div>
          <div className="space-y-1">
            <label className="text-muted text-xs font-medium">
              Note (réf. virement)
            </label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex. CCP, n° opération…"
              disabled={pending}
            />
          </div>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Banknote className="size-4" />
            )}
            Enregistrer
          </Button>
          <ActionNote note={fb} className="mt-2" />
        </div>
      )}
    </li>
  );
}
