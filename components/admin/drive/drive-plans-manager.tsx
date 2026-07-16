"use client";

import { useState, useTransition } from "react";
import {
  Plus,
  Save,
  Trash2,
  ChevronUp,
  ChevronDown,
  Loader2,
  Crown,
  ShieldCheck,
  Star,
} from "lucide-react";
import {
  upsertDrivePlan,
  deleteDrivePlan,
  setPlanActive,
  reorderDrivePlans,
  type DrivePlan,
  type BillingPeriod,
} from "@/app/admin/chauffeurs/(hub)/abonnements/actions";
import { useConfirm } from "@/components/ui/confirm";

const PERIOD_DAYS: Record<BillingPeriod, number> = {
  day: 1,
  week: 7,
  month: 30,
};
const PERIOD_LABEL: Record<BillingPeriod, string> = {
  day: "jour",
  week: "semaine",
  month: "mois",
};

const blankPlan = (): DrivePlan => ({
  code: "",
  title: "",
  subtitle: "",
  price_da: 300,
  billing_period: "month",
  duration_days: 30,
  commission_rate: 0,
  cashback_rate: 0,
  advantages: [],
  badge_label: "",
  badge_color: "#6C2BD9",
  display_rank: 0,
  is_priority: false,
  is_default: false,
  is_active: true,
  subscribers: 0,
});

export function DrivePlansManager({ initial }: { initial: DrivePlan[] }) {
  const [plans, setPlans] = useState<DrivePlan[]>(initial);
  const [editing, setEditing] = useState<DrivePlan | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const confirm = useConfirm();

  const refreshFromServer = (updated?: DrivePlan, originalCode?: string) => {
    if (!updated) return;
    setPlans((cur) => {
      const key = originalCode ?? updated.code;
      const exists = cur.some((p) => p.code === key);
      const next = exists
        ? cur.map((p) => (p.code === key ? updated : p))
        : [...cur, updated];
      return next.sort((a, b) => b.display_rank - a.display_rank);
    });
  };

  const openNew = () => {
    setEditing(blankPlan());
    setIsNew(true);
    setMsg({});
  };
  const openEdit = (p: DrivePlan) => {
    setEditing({ ...p, advantages: [...p.advantages] });
    setIsNew(false);
    setMsg({});
  };

  const save = () => {
    if (!editing) return;
    start(async () => {
      setMsg({});
      const res = await upsertDrivePlan({
        ...editing,
        originalCode: isNew ? undefined : editing.code,
      });
      if (res.error) {
        setMsg({ error: res.error });
        return;
      }
      refreshFromServer(
        { ...editing, code: res.code ?? editing.code },
        isNew ? undefined : editing.code
      );
      setEditing(null);
      setMsg({ ok: "Plan enregistré ✓" });
    });
  };

  const toggleActive = (p: DrivePlan) =>
    start(async () => {
      const res = await setPlanActive(p.code, !p.is_active);
      if (res.error) return setMsg({ error: res.error });
      setPlans((cur) =>
        cur.map((x) =>
          x.code === p.code ? { ...x, is_active: !x.is_active } : x
        )
      );
    });

  const remove = (p: DrivePlan) =>
    start(async () => {
      const okConfirm = await confirm({
        title: `Supprimer le plan « ${p.title} » ?`,
        message: "Action définitive.",
        confirmLabel: "Supprimer",
        danger: true,
      });
      if (!okConfirm) return;
      const res = await deleteDrivePlan(p.code);
      if (res.error) return setMsg({ error: res.error });
      setPlans((cur) => cur.filter((x) => x.code !== p.code));
      setMsg({ ok: "Plan supprimé ✓" });
    });

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= plans.length) return;
    const next = [...plans];
    [next[idx], next[j]] = [next[j], next[idx]];
    setPlans(next);
    start(async () => {
      const res = await reorderDrivePlans(next.map((p) => p.code));
      if (res.error) setMsg({ error: res.error });
    });
  };

  // Overview « Uber-style » : abonnés actifs, revenu mensuel estimé, plans actifs.
  const activeSubs = plans.reduce((s, p) => s + (p.subscribers ?? 0), 0);
  const monthlyRevenue = plans.reduce(
    (s, p) =>
      s + (p.subscribers ?? 0) * p.price_da * (30 / (p.duration_days || 30)),
    0
  );
  const activePlans = plans.filter((p) => p.is_active && !p.is_default).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="Abonnés actifs"
          value={activeSubs.toLocaleString("fr-FR")}
        />
        <Stat
          label="Revenu mensuel estimé"
          value={`${Math.round(monthlyRevenue).toLocaleString("fr-FR")} DA`}
        />
        <Stat label="Plans actifs" value={String(activePlans)} />
      </div>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Plans d’abonnement</h2>
          <p className="text-muted text-sm">
            Prix, commission chauffeur, cashback client, avantages, badge et
            ordre d’affichage. Les taux et prix sont imposés côté serveur — un
            chauffeur ne peut jamais les modifier.
          </p>
        </div>
        <button
          onClick={openNew}
          className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold text-white"
        >
          <Plus className="size-4" /> Nouveau plan
        </button>
      </header>

      {msg.ok && (
        <p className="bg-success-50 text-success-700 rounded-[10px] px-3 py-2 text-sm font-medium">
          {msg.ok}
        </p>
      )}
      {msg.error && (
        <p className="bg-danger-50 text-danger-700 rounded-[10px] px-3 py-2 text-sm font-medium">
          {msg.error}
        </p>
      )}

      <ul className="space-y-3">
        {plans.map((p, idx) => (
          <li key={p.code} className={cnCard(p.is_active)}>
            <div className="flex items-start gap-3">
              <div className="flex flex-col">
                <button
                  disabled={idx === 0 || pending}
                  onClick={() => move(idx, -1)}
                  className="text-muted hover:text-foreground disabled:opacity-30"
                  aria-label="Monter"
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  disabled={idx === plans.length - 1 || pending}
                  onClick={() => move(idx, 1)}
                  className="text-muted hover:text-foreground disabled:opacity-30"
                  aria-label="Descendre"
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{p.title}</span>
                  {p.badge_label && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
                      style={{ backgroundColor: p.badge_color || "#6C2BD9" }}
                    >
                      {p.badge_label}
                    </span>
                  )}
                  {p.is_default && (
                    <span className="bg-surface-2 text-muted rounded-full px-2 py-0.5 text-[11px] font-semibold">
                      Par défaut
                    </span>
                  )}
                  {p.is_priority && (
                    <Star className="size-3.5 text-amber-500" />
                  )}
                  {!p.is_active && (
                    <span className="text-muted rounded-full border border-dashed px-2 py-0.5 text-[11px]">
                      Inactif
                    </span>
                  )}
                </div>
                <p className="text-muted mt-0.5 text-sm">
                  {p.price_da > 0
                    ? `${p.price_da} DA / ${PERIOD_LABEL[p.billing_period]}`
                    : "Gratuit"}
                  {" · "}commission {pct(p.commission_rate)} · cashback{" "}
                  {pct(p.cashback_rate)} · rang {p.display_rank}
                  {p.subscribers ? ` · ${p.subscribers} abonné(s)` : ""}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => toggleActive(p)}
                  disabled={pending}
                  className="text-muted hover:bg-surface-2 rounded-[8px] px-2 py-1 text-xs font-semibold"
                >
                  {p.is_active ? "Désactiver" : "Activer"}
                </button>
                <button
                  onClick={() => openEdit(p)}
                  className="text-primary-700 hover:bg-primary-50 rounded-[8px] px-2 py-1 text-xs font-semibold"
                >
                  Éditer
                </button>
                {!p.is_default && (
                  <button
                    onClick={() => remove(p)}
                    disabled={pending}
                    className="text-danger-600 hover:bg-danger-50 rounded-[8px] p-1.5"
                    aria-label="Supprimer"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <PlanEditor
          plan={editing}
          isNew={isNew}
          pending={pending}
          onChange={setEditing}
          onSave={save}
          onCancel={() => setEditing(null)}
          error={msg.error}
        />
      )}
    </div>
  );
}

function PlanEditor({
  plan,
  isNew,
  pending,
  onChange,
  onSave,
  onCancel,
  error,
}: {
  plan: DrivePlan;
  isNew: boolean;
  pending: boolean;
  onChange: (p: DrivePlan) => void;
  onSave: () => void;
  onCancel: () => void;
  error?: string;
}) {
  const set = <K extends keyof DrivePlan>(k: K, v: DrivePlan[K]) =>
    onChange({ ...plan, [k]: v });
  const cashbackTooHigh = plan.cashback_rate > plan.commission_rate;

  return (
    <div className="border-primary-200 bg-surface fixed inset-x-0 bottom-0 z-40 mx-auto max-h-[85vh] max-w-[1100px] overflow-y-auto rounded-t-2xl border-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl lg:p-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-bold">
          {isNew ? "Nouveau plan" : `Éditer « ${plan.title} »`}
        </h3>
        <button onClick={onCancel} className="text-muted text-sm">
          Fermer
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Titre">
          <input
            className={inputCls}
            value={plan.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Ex. Prioritaire"
          />
        </Field>
        <Field label="Sous-titre">
          <input
            className={inputCls}
            value={plan.subtitle ?? ""}
            onChange={(e) => set("subtitle", e.target.value)}
            placeholder="Ex. Passez devant à la distribution"
          />
        </Field>
        <Field label="Période">
          <select
            className={inputCls}
            value={plan.billing_period}
            onChange={(e) => {
              const bp = e.target.value as BillingPeriod;
              onChange({
                ...plan,
                billing_period: bp,
                duration_days: PERIOD_DAYS[bp],
              });
            }}
          >
            <option value="day">Par jour</option>
            <option value="week">Par semaine</option>
            <option value="month">Par mois</option>
          </select>
        </Field>
        <Field label="Prix (DA)">
          <input
            type="number"
            min={0}
            className={inputCls}
            value={plan.price_da}
            onChange={(e) => set("price_da", Math.max(0, +e.target.value))}
          />
        </Field>
        <Field label="Durée (jours)" hint="Longueur réelle de l’abonnement.">
          <input
            type="number"
            min={1}
            className={inputCls}
            value={plan.duration_days}
            onChange={(e) => set("duration_days", Math.max(1, +e.target.value))}
          />
        </Field>
        <Field label="Commission chauffeur (%)">
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            className={inputCls}
            value={round1(plan.commission_rate * 100)}
            onChange={(e) =>
              set("commission_rate", clamp01(+e.target.value / 100))
            }
          />
        </Field>
        <Field
          label="Cashback client (%)"
          hint="Financé par la commission → ne peut pas la dépasser."
        >
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            className={inputCls + (cashbackTooHigh ? " border-danger-400" : "")}
            value={round1(plan.cashback_rate * 100)}
            onChange={(e) =>
              set("cashback_rate", clamp01(+e.target.value / 100))
            }
          />
        </Field>
        <Field label="Rang d’affichage" hint="Plus élevé = montré en premier.">
          <input
            type="number"
            className={inputCls}
            value={plan.display_rank}
            onChange={(e) => set("display_rank", Math.round(+e.target.value))}
          />
        </Field>
        <Field label="Badge (texte)">
          <input
            className={inputCls}
            value={plan.badge_label ?? ""}
            onChange={(e) => set("badge_label", e.target.value)}
            placeholder="Ex. Premium"
          />
        </Field>
        <Field label="Couleur du badge">
          <input
            type="color"
            className="h-10 w-full rounded-[10px] border"
            value={plan.badge_color ?? "#6C2BD9"}
            onChange={(e) => set("badge_color", e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          label="Avantages (un par ligne)"
          hint="Affichés au chauffeur sur la carte du plan."
        >
          <textarea
            rows={3}
            className={inputCls}
            value={plan.advantages.join("\n")}
            onChange={(e) => set("advantages", e.target.value.split("\n"))}
            placeholder={"Priorité d’affichage\nReçoit les courses en premier"}
          />
        </Field>
        <div className="flex flex-col justify-center gap-2">
          <Toggle
            label="Accès prioritaire au dispatch"
            icon={ShieldCheck}
            checked={plan.is_priority}
            onChange={(v) => set("is_priority", v)}
          />
          <Toggle
            label="Actif (proposable au chauffeur)"
            icon={Crown}
            checked={plan.is_active}
            onChange={(v) => set("is_active", v)}
          />
        </div>
      </div>

      {/* Clarté monétaire : ce que garde réellement la plateforme sur une course. */}
      <p className="text-muted mt-3 text-sm">
        Sur une course, la plateforme garde{" "}
        <b className="text-foreground">
          {pct(Math.max(0, plan.commission_rate - plan.cashback_rate))}
        </b>{" "}
        (commission {pct(plan.commission_rate)} − cashback client{" "}
        {pct(plan.cashback_rate)}) ; le reste revient au chauffeur.
      </p>
      {cashbackTooHigh && (
        <p className="text-danger-600 mt-2 text-sm font-medium">
          Le cashback ({pct(plan.cashback_rate)}) dépasse la commission (
          {pct(plan.commission_rate)}) — il doit rester inférieur ou égal.
        </p>
      )}
      {error && (
        <p className="text-danger-600 mt-2 text-sm font-medium">{error}</p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button onClick={onCancel} className="text-muted px-3 py-2 text-sm">
          Annuler
        </button>
        <button
          onClick={onSave}
          disabled={pending || cashbackTooHigh || !plan.title.trim()}
          className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Enregistrer
        </button>
      </div>
    </div>
  );
}

/* ---------- primitives ---------- */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border bg-surface rounded-[12px] border p-3">
      <p className="text-muted text-[11px] font-semibold">{label}</p>
      <p className="mt-0.5 text-lg font-extrabold">{value}</p>
    </div>
  );
}

const inputCls =
  "border-border bg-surface w-full rounded-[10px] border px-3 py-2 text-sm";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-muted mb-1 block text-xs font-semibold">
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-muted mt-1 block text-[11px]">{hint}</span>
      )}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  icon: Icon,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon: typeof Crown;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={
        "flex items-center gap-2 rounded-[10px] border px-3 py-2 text-sm font-medium " +
        (checked
          ? "border-primary-300 bg-primary-50 text-primary-700"
          : "border-border text-muted")
      }
    >
      <Icon className="size-4" />
      {label}
      <span className="ml-auto text-xs">{checked ? "OUI" : "non"}</span>
    </button>
  );
}

const cnCard = (active: boolean) =>
  "border-border rounded-[14px] border p-3 " +
  (active ? "bg-surface" : "bg-surface-2 opacity-80");
const pct = (r: number) => `${round1(r * 100)} %`;
const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
