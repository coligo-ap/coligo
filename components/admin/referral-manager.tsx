"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Gift,
  Loader2,
  Save,
  Search,
  ShieldAlert,
  Undo2,
  X,
} from "lucide-react";
import Link from "next/link";
import { cn, formatDA } from "@/lib/utils";
import { useConfirm, usePrompt } from "@/components/ui/confirm";
import {
  decideReferral,
  revokeReferral,
  searchReferrals,
  updateReferralSettings,
} from "@/app/admin/marketing/parrainage/actions";

// =============================================================================
// ReferralManager — gestion complète du parrainage (style Uber) :
// [Aperçu KPIs] [Réglages] [Parrainages] [Revue fraude]. Panneaux MONTÉS
// (inactif en `hidden`) — règle CLAUDE.md, pas de perte de saisie.
// =============================================================================

export type AdminReferralStats = {
  total: number;
  pending: number;
  held: number;
  rewarded: number;
  rejected: number;
  revoked: number;
  expired: number;
  cost_da: number;
  codes_total: number;
};

export type AdminReferralSettings = {
  enabled: boolean;
  reward_referrer_da: number;
  reward_referee_da: number;
  min_order_da: number;
  max_referrals_month: number;
  attribution_expiry_days: number;
};

export type AdminReferralRow = {
  id: string;
  status: "pending" | "held" | "rewarded" | "rejected" | "revoked" | "expired";
  code: string;
  created_at: string;
  decided_at: string | null;
  credited_at: string | null;
  expires_at: string;
  fraud_note: string | null;
  reward_referrer_da: number;
  reward_referee_da: number;
  qualifying_order: {
    id: string;
    order_number: string | null;
    total_da: number;
  } | null;
  referrer: { id: string; name: string | null; phone: string | null };
  referee: { id: string; name: string | null; phone: string | null };
};

const STATUS_META: Record<
  AdminReferralRow["status"],
  { label: string; cls: string }
> = {
  pending: { label: "Attend sa commande", cls: "bg-surface-2 text-muted" },
  held: { label: "À examiner", cls: "bg-amber-50 text-amber-700" },
  rewarded: { label: "Récompensé", cls: "bg-success-50 text-success-700" },
  rejected: { label: "Rejeté", cls: "bg-rose-50 text-rose-700" },
  revoked: { label: "Révoqué", cls: "bg-rose-50 text-rose-700" },
  expired: { label: "Expiré", cls: "bg-surface-2 text-subtle" },
};

const FILTERS: { key: string | null; label: string }[] = [
  { key: null, label: "Tous" },
  { key: "pending", label: "En attente" },
  { key: "held", label: "À examiner" },
  { key: "rewarded", label: "Récompensés" },
  { key: "rejected", label: "Rejetés" },
  { key: "revoked", label: "Révoqués" },
  { key: "expired", label: "Expirés" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-DZ", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Tab = "apercu" | "reglages" | "liste" | "revue";

export function ReferralManager({
  stats,
  rows: initialRows,
  settings,
}: {
  stats: AdminReferralStats | null;
  rows: AdminReferralRow[];
  settings: AdminReferralSettings | null;
}) {
  const heldCount = stats?.held ?? 0;
  const [tab, setTab] = useState<Tab>(heldCount > 0 ? "revue" : "apercu");

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "apercu", label: "Aperçu" },
    { key: "reglages", label: "Réglages" },
    { key: "liste", label: "Parrainages", badge: stats?.total || undefined },
    { key: "revue", label: "Revue fraude", badge: heldCount || undefined },
  ];

  return (
    <div>
      {/* Nav segmentée */}
      <div className="border-border bg-surface-2 mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-[13px] border p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-sm font-bold transition-colors",
              tab === t.key
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            )}
          >
            {t.label}
            {t.badge != null && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] font-extrabold",
                  t.key === "revue"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-surface-3 text-muted"
                )}
              >
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className={cn(tab !== "apercu" && "hidden")}>
        <OverviewPanel stats={stats} settings={settings} />
      </div>
      <div className={cn(tab !== "reglages" && "hidden")}>
        <SettingsPanel settings={settings} />
      </div>
      <div className={cn(tab !== "liste" && "hidden")}>
        <ListPanel initialRows={initialRows} />
      </div>
      <div className={cn(tab !== "revue" && "hidden")}>
        <ReviewPanel rows={initialRows} />
      </div>
    </div>
  );
}

/* ───────────────────────────── Aperçu ───────────────────────────── */

function OverviewPanel({
  stats,
  settings,
}: {
  stats: AdminReferralStats | null;
  settings: AdminReferralSettings | null;
}) {
  if (!stats) {
    return (
      <p className="text-muted text-sm">
        Statistiques indisponibles — recharge la page.
      </p>
    );
  }
  const conversion =
    stats.total > 0 ? Math.round((stats.rewarded / stats.total) * 100) : 0;

  return (
    <div className="space-y-3">
      {settings && !settings.enabled && (
        <div className="rounded-[13px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          {
            "Programme DÉSACTIVÉ — les nouveaux codes ne s'attribuent pas. Active dans « Réglages » (et le drapeau referral dans Plateforme → Contrôle)."
          }
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Attributions" value={String(stats.total)} />
        <Kpi label="Récompensés" value={String(stats.rewarded)} accent />
        <Kpi
          label="À examiner"
          value={String(stats.held)}
          warn={stats.held > 0}
        />
        <Kpi label="Coût total" value={formatDA(stats.cost_da)} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Attendent commande" value={String(stats.pending)} />
        <Kpi label="Conversion" value={`${conversion} %`} />
        <Kpi
          label="Rejetés / révoqués"
          value={String(stats.rejected + stats.revoked)}
        />
        <Kpi label="Codes générés" value={String(stats.codes_total)} />
      </div>
      {settings && (
        <div className="border-border bg-surface rounded-[16px] border p-4 text-sm">
          <p className="text-muted text-[11px] font-extrabold tracking-wide uppercase">
            Réglages actifs
          </p>
          <p className="text-foreground mt-1.5 font-medium">
            Parrain {formatDA(settings.reward_referrer_da)} · Filleul{" "}
            {formatDA(settings.reward_referee_da)} · Commande min{" "}
            {formatDA(settings.min_order_da)} · {settings.max_referrals_month}
            /mois · expire {settings.attribution_expiry_days} j
          </p>
        </div>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={cn(
        "border-border bg-surface rounded-[14px] border p-3",
        warn && "border-amber-200 bg-amber-50"
      )}
    >
      <p
        className={cn(
          "text-lg font-black tracking-tight tabular-nums",
          accent
            ? "text-primary-700"
            : warn
              ? "text-amber-700"
              : "text-foreground"
        )}
      >
        {value}
      </p>
      <p className="text-muted text-[11px] font-bold">{label}</p>
    </div>
  );
}

/* ──────────────────────────── Réglages ──────────────────────────── */

function SettingsPanel({
  settings,
}: {
  settings: AdminReferralSettings | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState<AdminReferralSettings>(
    settings ?? {
      enabled: false,
      reward_referrer_da: 300,
      reward_referee_da: 300,
      min_order_da: 500,
      max_referrals_month: 20,
      attribution_expiry_days: 30,
    }
  );
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const num =
    (key: keyof AdminReferralSettings) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: Number(e.target.value) || 0 }));

  const save = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await updateReferralSettings(form);
      setMsg(
        res.ok
          ? { ok: true, text: "Réglages enregistrés." }
          : { ok: false, text: res.error }
      );
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="border-border bg-surface max-w-xl rounded-[16px] border p-4">
      <label className="flex items-center justify-between gap-3 py-1">
        <span>
          <span className="text-foreground block text-sm font-extrabold">
            Programme actif
          </span>
          <span className="text-muted block text-xs">
            Le drapeau client `referral` (Plateforme → Contrôle) doit aussi être
            actif pour afficher la page aux clients.
          </span>
        </span>
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) =>
            setForm((f) => ({ ...f, enabled: e.target.checked }))
          }
          className="accent-primary-600 size-5"
        />
      </label>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field
          label="Récompense parrain (DA)"
          value={form.reward_referrer_da}
          onChange={num("reward_referrer_da")}
        />
        <Field
          label="Récompense filleul (DA)"
          value={form.reward_referee_da}
          onChange={num("reward_referee_da")}
        />
        <Field
          label="Commande minimum (DA)"
          value={form.min_order_da}
          onChange={num("min_order_da")}
        />
        <Field
          label="Plafond / parrain / mois"
          value={form.max_referrals_month}
          onChange={num("max_referrals_month")}
        />
        <Field
          label="Expiration attribution (jours)"
          value={form.attribution_expiry_days}
          onChange={num("attribution_expiry_days")}
        />
      </div>

      <p className="text-subtle mt-2 text-xs">
        {
          "Les montants d'une attribution déjà créée sont FIGÉS (promesse tenue) — un changement ne vaut que pour les prochains filleuls."
        }
      </p>

      {msg && (
        <p
          className={cn(
            "mt-2 text-sm font-medium",
            msg.ok ? "text-success-700" : "text-rose-600"
          )}
        >
          {msg.text}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="bg-primary-600 hover:bg-primary-700 mt-3 inline-flex items-center gap-2 rounded-[11px] px-4 py-2.5 text-sm font-extrabold text-white transition-colors disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Save className="size-4" />
        )}
        Enregistrer
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="block">
      <span className="text-muted mb-1 block text-xs font-bold">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={onChange}
        className="border-border bg-surface text-foreground focus:border-primary-400 w-full rounded-[11px] border px-3 py-2 text-sm font-semibold outline-none"
      />
    </label>
  );
}

/* ──────────────────────────── Parrainages ───────────────────────── */

function ListPanel({ initialRows }: { initialRows: AdminReferralRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(
    () => (filter ? rows.filter((r) => r.status === filter) : rows),
    [rows, filter]
  );

  const runSearch = () => {
    setError(null);
    startSearch(async () => {
      const res = await searchReferrals({ q: q || null });
      if (res.ok) setRows(res.rows as AdminReferralRow[]);
      else setError(res.error);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="text-subtle pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Nom, téléphone ou code…"
            className="border-border bg-surface text-foreground w-full rounded-[11px] border py-2 ps-9 pe-3 text-sm outline-none"
          />
        </div>
        <button
          type="button"
          onClick={runSearch}
          disabled={searching}
          className="bg-primary-600 hover:bg-primary-700 rounded-[11px] px-3.5 py-2 text-sm font-extrabold text-white transition-colors disabled:opacity-60"
        >
          {searching ? <Loader2 className="size-4 animate-spin" /> : "Chercher"}
        </button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-extrabold transition-colors",
              filter === f.key
                ? "bg-primary-600 text-white"
                : "bg-surface-2 text-muted hover:text-foreground"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <RowsList rows={visible} />
    </div>
  );
}

/* ──────────────────────────── Revue fraude ──────────────────────── */

function ReviewPanel({ rows }: { rows: AdminReferralRow[] }) {
  const held = rows.filter((r) => r.status === "held");
  if (held.length === 0) {
    return (
      <div className="border-border bg-surface rounded-[16px] border p-6 text-center">
        <span className="bg-success-50 text-success-700 mx-auto grid size-11 place-items-center rounded-2xl">
          <Check className="size-5" />
        </span>
        <p className="text-foreground mt-2 text-sm font-extrabold">
          Aucune revue en attente
        </p>
        <p className="text-muted mt-0.5 text-xs">
          Les parrainages suspects (même appareil, plafond) apparaîtront ici
          avant tout crédit.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-[13px] border border-amber-200 bg-amber-50 px-4 py-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-700" />
        <p className="text-sm font-medium text-amber-800">
          Récompenses GELÉES en attendant ta décision. Approuver crédite
          immédiatement les deux clients ; rejeter ne crédite rien.
        </p>
      </div>
      <RowsList rows={held} />
    </div>
  );
}

/* ─────────────────────── Liste de lignes + détail ───────────────── */

function RowsList({ rows }: { rows: AdminReferralRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <div className="border-border bg-surface rounded-[16px] border p-6 text-center">
        <p className="text-muted text-sm">Aucun parrainage pour ce filtre.</p>
      </div>
    );
  }

  return (
    <div className="border-border bg-surface divide-border divide-y overflow-hidden rounded-[16px] border">
      {rows.map((r) => (
        <ReferralRow
          key={r.id}
          row={r}
          expanded={expanded === r.id}
          onToggle={() => setExpanded((e) => (e === r.id ? null : r.id))}
        />
      ))}
    </div>
  );
}

function ReferralRow({
  row,
  expanded,
  onToggle,
}: {
  row: AdminReferralRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const prompt = usePrompt();
  // État LOCAL par ligne (règle CLAUDE.md) : une action ne fige QUE cette ligne.
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const meta = STATUS_META[row.status];

  const approve = () => {
    setError(null);
    startTransition(async () => {
      const ok = await confirm({
        title: "Approuver ce parrainage ?",
        message: `${formatDA(row.reward_referrer_da)} (parrain) + ${formatDA(row.reward_referee_da)} (filleul) seront crédités immédiatement sur Coligo Pay.`,
        confirmLabel: "Approuver et créditer",
      });
      if (!ok) return;
      const res = await decideReferral({ id: row.id, action: "approve" });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  };

  const reject = () => {
    setError(null);
    startTransition(async () => {
      const note = await prompt({
        title: "Rejeter — motif (interne)",
        placeholder: "Ex : auto-parrainage confirmé (même appareil)",
      });
      if (note === null) return;
      const res = await decideReferral({
        id: row.id,
        action: "reject",
        note: note || undefined,
      });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  };

  const revoke = () => {
    setError(null);
    startTransition(async () => {
      const ok = await confirm({
        title: "Révoquer ce parrainage ?",
        message: `Les ${formatDA(row.reward_referrer_da + row.reward_referee_da)} crédités seront repris sur les deux portefeuilles (refusé si déjà dépensés).`,
        confirmLabel: "Révoquer",
        danger: true,
      });
      if (!ok) return;
      const note = await prompt({
        title: "Motif de révocation (interne)",
        placeholder: "Ex : fraude confirmée après enquête",
      });
      if (note === null) return;
      const res = await revokeReferral({ id: row.id, note: note || undefined });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="hover:bg-surface-2 flex w-full items-center gap-3 px-4 py-3 text-start transition-colors"
      >
        <Gift className="text-primary-600 size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="text-foreground block truncate text-sm font-extrabold">
            {row.referrer.name ?? "—"}{" "}
            <span className="text-subtle font-medium">parraine</span>{" "}
            {row.referee.name ?? "—"}
          </span>
          <span className="text-muted block text-xs">
            {row.code} · {fmtDate(row.created_at)}
          </span>
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold",
            meta.cls
          )}
        >
          {meta.label}
        </span>
        <ChevronDown
          className={cn(
            "text-subtle size-4 shrink-0 transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>

      {expanded && (
        <div className="border-border bg-surface-2/50 border-t px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <PartyCard
              title="Parrain"
              party={row.referrer}
              amountDa={row.reward_referrer_da}
            />
            <PartyCard
              title="Filleul"
              party={row.referee}
              amountDa={row.reward_referee_da}
            />
          </div>

          <dl className="text-muted mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <Info k="Commande qualifiante">
              {row.qualifying_order
                ? `${row.qualifying_order.order_number ?? "—"} · ${formatDA(row.qualifying_order.total_da)}`
                : "—"}
            </Info>
            <Info k="Expire le">{fmtDate(row.expires_at)}</Info>
            <Info k="Décidé le">{fmtDate(row.decided_at)}</Info>
            <Info k="Crédité le">{fmtDate(row.credited_at)}</Info>
          </dl>

          {row.fraud_note && (
            <p className="mt-2 flex items-start gap-1.5 rounded-[10px] bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              {row.fraud_note}
            </p>
          )}

          {error && (
            <p className="mt-2 text-sm font-medium text-rose-600">{error}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {row.status === "held" && (
              <>
                <ActionBtn onClick={approve} busy={busy} icon={Check}>
                  Approuver et créditer
                </ActionBtn>
                <ActionBtn onClick={reject} busy={busy} icon={X} danger>
                  Rejeter
                </ActionBtn>
              </>
            )}
            {row.status === "rewarded" && (
              <ActionBtn onClick={revoke} busy={busy} icon={Undo2} danger>
                Révoquer (reprendre les crédits)
              </ActionBtn>
            )}
            <Link
              href="/admin/devices"
              className="text-primary-700 inline-flex items-center gap-1 text-xs font-bold hover:underline"
            >
              <ExternalLink className="size-3.5" />
              Appareils / IP partagées
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function PartyCard({
  title,
  party,
  amountDa,
}: {
  title: string;
  party: { id: string; name: string | null; phone: string | null };
  amountDa: number;
}) {
  return (
    <div className="border-border bg-surface rounded-[12px] border px-3 py-2.5">
      <p className="text-subtle text-[10px] font-extrabold tracking-wide uppercase">
        {title} · {formatDA(amountDa)}
      </p>
      <p className="text-foreground mt-0.5 text-sm font-extrabold">
        {party.name ?? "—"}
      </p>
      <p className="text-muted text-xs">{party.phone ?? "—"}</p>
    </div>
  );
}

function Info({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 sm:block">
      <dt className="font-bold">{k}</dt>
      <dd className="text-foreground font-medium">{children}</dd>
    </div>
  );
}

function ActionBtn({
  onClick,
  busy,
  icon: Icon,
  danger,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  icon: React.ComponentType<{ className?: string }>;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-extrabold transition-colors disabled:opacity-60",
        danger
          ? "bg-rose-50 text-rose-700 hover:bg-rose-100"
          : "bg-primary-600 hover:bg-primary-700 text-white"
      )}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Icon className="size-3.5" />
      )}
      {children}
    </button>
  );
}
