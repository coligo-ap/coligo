"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import {
  addWheelPrize,
  deleteWheelPrize,
  updateWheelPrize,
  updateWheelSettings,
} from "@/app/admin/marketing/roue/actions";

// =============================================================================
// WheelManager — KPIs, réglages (série) et LOTS de la Roue Coligo. La somme
// des poids fait la probabilité : affichée en % à côté de chaque lot.
// =============================================================================

export type AdminWheelStats = {
  spins_today: number;
  spins_7d: number;
  players_7d: number;
  cost_7d: number;
  cost_total: number;
  best_streak: number;
};

export type AdminWheelSettings = {
  enabled: boolean;
  streak_target: number;
  streak_multiplier: number;
  /** Lot « Livraison offerte » (mig 0421). */
  free_delivery_valid_days: number;
  free_delivery_max_fee_da: number;
};

export type AdminWheelPrize = {
  id: string;
  kind: "voucher" | "nothing" | "free_delivery";
  amount_da: number;
  weight: number;
  label_fr: string;
  label_ar: string | null;
  active: boolean;
  position: number;
};

export function WheelManager({
  stats,
  prizes,
  settings,
}: {
  stats: AdminWheelStats | null;
  prizes: AdminWheelPrize[];
  settings: AdminWheelSettings | null;
}) {
  const totalWeight = prizes
    .filter((p) => p.active)
    .reduce((s, p) => s + p.weight, 0);

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Kpi label="Tours aujourd'hui" value={String(stats.spins_today)} />
          <Kpi label="Joueurs (7 j)" value={String(stats.players_7d)} />
          <Kpi label="Tours (7 j)" value={String(stats.spins_7d)} />
          <Kpi label="Coût (7 j)" value={formatDA(stats.cost_7d)} />
          <Kpi label="Coût total" value={formatDA(stats.cost_total)} />
          <Kpi label="Meilleure série" value={`${stats.best_streak} j`} />
        </div>
      )}

      <SettingsCard settings={settings} />
      <PrizesCard prizes={prizes} totalWeight={totalWeight} />
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border bg-surface rounded-[14px] border p-3">
      <p className="text-foreground text-lg font-black tracking-tight tabular-nums">
        {value}
      </p>
      <p className="text-muted text-[11px] font-bold">{label}</p>
    </div>
  );
}

function SettingsCard({ settings }: { settings: AdminWheelSettings | null }) {
  const router = useRouter();
  const [form, setForm] = useState<AdminWheelSettings>(
    settings ?? {
      enabled: false,
      streak_target: 7,
      streak_multiplier: 2,
      free_delivery_valid_days: 7,
      free_delivery_max_fee_da: 250,
    }
  );
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="border-border bg-surface rounded-[16px] border p-4">
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="text-foreground block text-sm font-extrabold">
            Roue active
          </span>
          <span className="text-muted block text-xs">
            Le drapeau client wheel (Plateforme → Contrôle) doit aussi être
            actif.
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
        <label className="block">
          <span className="text-muted mb-1 block text-xs font-bold">
            Jour bonus (série)
          </span>
          <input
            type="number"
            min={2}
            value={form.streak_target}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                streak_target: Number(e.target.value) || 7,
              }))
            }
            className="border-border bg-surface text-foreground w-full rounded-[11px] border px-3 py-2 text-sm font-semibold outline-none"
          />
        </label>
        <label className="block">
          <span className="text-muted mb-1 block text-xs font-bold">
            Multiplicateur du bonus
          </span>
          <input
            type="number"
            min={1}
            value={form.streak_multiplier}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                streak_multiplier: Number(e.target.value) || 2,
              }))
            }
            className="border-border bg-surface text-foreground w-full rounded-[11px] border px-3 py-2 text-sm font-semibold outline-none"
          />
        </label>
        <label className="block">
          <span className="text-muted mb-1 block text-xs font-bold">
            Livraison offerte — validité (jours)
          </span>
          <input
            type="number"
            min={1}
            max={60}
            value={form.free_delivery_valid_days}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                free_delivery_valid_days: Number(e.target.value) || 7,
              }))
            }
            className="border-border bg-surface text-foreground w-full rounded-[11px] border px-3 py-2 text-sm font-semibold outline-none"
          />
        </label>
        <label className="block">
          <span className="text-muted mb-1 block text-xs font-bold">
            Livraison offerte — plafond couvert (DA)
          </span>
          <input
            type="number"
            min={50}
            step={10}
            value={form.free_delivery_max_fee_da}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                free_delivery_max_fee_da: Number(e.target.value) || 250,
              }))
            }
            className="border-border bg-surface text-foreground w-full rounded-[11px] border px-3 py-2 text-sm font-semibold outline-none"
          />
        </label>
      </div>
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
        disabled={pending}
        onClick={() => {
          setMsg(null);
          startTransition(async () => {
            const res = await updateWheelSettings(form);
            setMsg(
              res.ok
                ? { ok: true, text: "Réglages enregistrés." }
                : { ok: false, text: res.error }
            );
            if (res.ok) router.refresh();
          });
        }}
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

function PrizesCard({
  prizes,
  totalWeight,
}: {
  prizes: AdminWheelPrize[];
  totalWeight: number;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="border-border bg-surface rounded-[16px] border p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-muted text-[11px] font-extrabold tracking-wide uppercase">
          Lots ({prizes.length}) — probabilité = poids / total
        </p>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-extrabold text-white transition-colors"
        >
          <Plus className="size-3.5" />
          Ajouter un lot
        </button>
      </div>

      {adding && <PrizeForm onDone={() => setAdding(false)} />}

      <div className="divide-border mt-1 divide-y">
        {prizes.map((p) => (
          <PrizeRow key={p.id} prize={p} totalWeight={totalWeight} />
        ))}
      </div>
    </div>
  );
}

function PrizeForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    kind: "voucher" as "voucher" | "nothing" | "free_delivery",
    label_fr: "",
    label_ar: "",
    amount_da: 100,
    weight: 10,
  });

  return (
    <div className="border-border bg-surface-2 mb-2 rounded-[13px] border p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-muted col-span-2 text-xs font-bold">
          Type de lot
          <select
            value={form.kind}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                kind: e.target.value as typeof form.kind,
              }))
            }
            className="border-border bg-surface text-foreground mt-1 w-full rounded-[10px] border px-3 py-2 text-sm font-semibold outline-none"
          >
            <option value="voucher">Bon d&apos;achat (DA)</option>
            <option value="free_delivery">
              Livraison offerte (validité/plafond dans les réglages)
            </option>
            <option value="nothing">Retente (rien)</option>
          </select>
        </label>
        <input
          placeholder="Libellé FR (ex : 100 DA offerts)"
          value={form.label_fr}
          onChange={(e) => setForm((f) => ({ ...f, label_fr: e.target.value }))}
          className="border-border bg-surface text-foreground col-span-2 rounded-[10px] border px-3 py-2 text-sm outline-none"
        />
        <input
          placeholder="Libellé AR (optionnel)"
          dir="rtl"
          value={form.label_ar}
          onChange={(e) => setForm((f) => ({ ...f, label_ar: e.target.value }))}
          className="border-border bg-surface text-foreground col-span-2 rounded-[10px] border px-3 py-2 text-sm outline-none"
        />
        <label className="text-muted text-xs font-bold">
          Montant DA (bons d&apos;achat uniquement)
          <input
            type="number"
            min={0}
            disabled={form.kind !== "voucher"}
            value={form.kind === "voucher" ? form.amount_da : 0}
            onChange={(e) =>
              setForm((f) => ({ ...f, amount_da: Number(e.target.value) || 0 }))
            }
            className="border-border bg-surface text-foreground mt-1 w-full rounded-[10px] border px-3 py-2 text-sm font-semibold outline-none disabled:opacity-50"
          />
        </label>
        <label className="text-muted text-xs font-bold">
          Poids
          <input
            type="number"
            min={1}
            value={form.weight}
            onChange={(e) =>
              setForm((f) => ({ ...f, weight: Number(e.target.value) || 1 }))
            }
            className="border-border bg-surface text-foreground mt-1 w-full rounded-[10px] border px-3 py-2 text-sm font-semibold outline-none"
          />
        </label>
      </div>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await addWheelPrize(form);
            if (!res.ok) setError(res.error);
            else {
              onDone();
              router.refresh();
            }
          });
        }}
        className="bg-primary-600 hover:bg-primary-700 mt-2 inline-flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-xs font-extrabold text-white disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : "Ajouter"}
      </button>
    </div>
  );
}

function PrizeRow({
  prize,
  totalWeight,
}: {
  prize: AdminWheelPrize;
  totalWeight: number;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  // État LOCAL par ligne (règle CLAUDE.md).
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    kind: prize.kind,
    amount_da: prize.amount_da,
    weight: prize.weight,
    label_fr: prize.label_fr,
    label_ar: prize.label_ar ?? "",
    active: prize.active,
  });
  const pct =
    prize.active && totalWeight > 0
      ? Math.round((prize.weight / totalWeight) * 1000) / 10
      : 0;

  const save = (patch?: Partial<typeof form>) => {
    setError(null);
    const next = { ...form, ...patch };
    setForm(next);
    startTransition(async () => {
      const res = await updateWheelPrize({ id: prize.id, ...next });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <div className="py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={form.label_fr}
          onChange={(e) => setForm((f) => ({ ...f, label_fr: e.target.value }))}
          onBlur={() => save()}
          className="border-border bg-surface text-foreground min-w-0 flex-1 rounded-[10px] border px-2.5 py-1.5 text-sm font-bold outline-none"
        />
        {/* Type figé à l'édition (créer un nouveau lot pour changer) — badge
            lisible pour distinguer bon d'achat / livraison offerte / retente. */}
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-1 text-[10px] font-extrabold",
            prize.kind === "free_delivery"
              ? "bg-primary-50 text-primary-700"
              : prize.kind === "voucher"
                ? "bg-success-50 text-success-700"
                : "bg-surface-2 text-subtle"
          )}
        >
          {prize.kind === "free_delivery"
            ? "Livraison offerte"
            : prize.kind === "voucher"
              ? "Bon d'achat"
              : "Retente"}
        </span>
        <input
          type="number"
          min={0}
          disabled={prize.kind !== "voucher"}
          value={form.amount_da}
          onChange={(e) =>
            setForm((f) => ({ ...f, amount_da: Number(e.target.value) || 0 }))
          }
          onBlur={() => save()}
          title="Montant (DA)"
          className="border-border bg-surface text-foreground w-20 rounded-[10px] border px-2 py-1.5 text-sm font-semibold outline-none disabled:opacity-50"
        />
        <input
          type="number"
          min={1}
          value={form.weight}
          onChange={(e) =>
            setForm((f) => ({ ...f, weight: Number(e.target.value) || 1 }))
          }
          onBlur={() => save()}
          title="Poids"
          className="border-border bg-surface text-foreground w-16 rounded-[10px] border px-2 py-1.5 text-sm font-semibold outline-none"
        />
        <span className="text-muted w-12 text-end text-xs font-black tabular-nums">
          {pct} %
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => save({ active: !form.active })}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-extrabold transition-colors disabled:opacity-60",
            form.active
              ? "bg-success-50 text-success-700"
              : "bg-surface-2 text-subtle"
          )}
        >
          {form.active ? "Actif" : "Inactif"}
        </button>
        <button
          type="button"
          disabled={pending}
          aria-label="Supprimer le lot"
          onClick={() => {
            startTransition(async () => {
              const ok = await confirm({
                title: "Supprimer ce lot ?",
                message: `« ${prize.label_fr} » sera retiré de la roue. Les tours déjà joués sont conservés.`,
                confirmLabel: "Supprimer",
                danger: true,
              });
              if (!ok) return;
              const res = await deleteWheelPrize(prize.id);
              if (!res.ok) setError(res.error);
              else router.refresh();
            });
          }}
          className="text-subtle grid size-8 place-items-center rounded-full transition-colors hover:text-rose-600 disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
