"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Pencil, Plus, Power, Trash2, X } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import {
  createPlatformCode,
  deletePlatformCode,
  togglePlatformCode,
  updatePlatformCode,
  type CodeInput,
} from "@/app/admin/marketing/actions";

// =============================================================================
// PlatformCodesManager — CRUD des codes promo plateforme + journal des usages.
// =============================================================================

export type AdminPlatformCode = {
  id: string;
  code: string;
  title_fr: string;
  title_ar: string | null;
  description_fr: string | null;
  description_ar: string | null;
  discount_kind: "percent" | "amount";
  discount_value: number;
  max_discount_da: number | null;
  min_subtotal_da: number | null;
  starts_at: string | null;
  ends_at: string | null;
  max_uses: number | null;
  max_uses_per_customer: number | null;
  uses_count: number;
  online_only: boolean;
  app_only: boolean;
  audience: "public" | "targeted" | "all";
  is_listed: boolean;
  active: boolean;
  created_at: string;
};

export type AdminRedemption = {
  id: string;
  promotion_id: string;
  order_id: string;
  code: string;
  discount_da: number;
  created_at: string;
  customers: { full_name: string | null; phone: string | null } | null;
  orders: { pickup_code: string | null } | null;
};

const AUDIENCE_LABEL: Record<AdminPlatformCode["audience"], string> = {
  public: "Public",
  targeted: "Ciblé",
  all: "Tous",
};

function emptyForm(): CodeInput {
  return {
    code: "",
    title_fr: "",
    title_ar: "",
    description_fr: "",
    description_ar: "",
    discount_kind: "percent",
    discount_value: 10,
    max_discount_da: null,
    min_subtotal_da: null,
    starts_at: null,
    ends_at: null,
    max_uses: null,
    max_uses_per_customer: 1,
    online_only: true,
    app_only: false,
    audience: "public",
    is_listed: true,
    active: true,
  };
}

export function PlatformCodesManager({
  codes,
  redemptions,
}: {
  codes: AdminPlatformCode[];
  redemptions: AdminRedemption[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<AdminPlatformCode | null>(null);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const byPromo = useMemo(() => {
    const m = new Map<string, AdminRedemption[]>();
    for (const r of redemptions) {
      const arr = m.get(r.promotion_id) ?? [];
      arr.push(r);
      m.set(r.promotion_id, arr);
    }
    return m;
  }, [redemptions]);

  function remove(c: AdminPlatformCode) {
    startTransition(async () => {
      const ok = await confirm({
        title: "Supprimer ce code ?",
        message: `Le code ${c.code} sera supprimé. Les usages déjà enregistrés sont conservés.`,
        confirmLabel: "Supprimer",
        danger: true,
      });
      if (!ok) return;
      const res = await deletePlatformCode(c.id);
      if (res.error) alert(res.error);
      else router.refresh();
    });
  }

  function toggle(c: AdminPlatformCode) {
    startTransition(async () => {
      const res = await togglePlatformCode(c.id, !c.active);
      if (res.error) alert(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setCreating(true)}
        className="bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 rounded-[12px] px-4 py-2.5 text-sm font-bold text-white"
      >
        <Plus className="size-4" /> Nouveau code
      </button>

      {codes.length === 0 ? (
        <p className="text-muted border-border rounded-[16px] border border-dashed px-6 py-10 text-center text-sm">
          Aucun code pour le moment.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {codes.map((c) => {
            const reds = byPromo.get(c.id) ?? [];
            const open = expanded === c.id;
            return (
              <li
                key={c.id}
                className="border-border bg-surface overflow-hidden rounded-[16px] border"
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="bg-primary-50 text-primary-700 rounded-md px-2 py-1 font-mono text-sm font-black tracking-wider">
                    {c.code}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate text-sm font-bold">
                      {c.title_fr}
                    </p>
                    <p className="text-muted text-xs">
                      {c.discount_kind === "percent"
                        ? `-${c.discount_value}%`
                        : `-${formatDA(c.discount_value)}`}
                      {" · "}
                      {AUDIENCE_LABEL[c.audience]}
                      {c.app_only ? " · Appli uniquement" : ""}
                      {" · "}
                      {c.uses_count}
                      {c.max_uses != null ? `/${c.max_uses}` : ""} usage(s)
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold",
                      c.active
                        ? "bg-success-50 text-success-700"
                        : "bg-surface-2 text-muted"
                    )}
                  >
                    {c.active ? "Actif" : "Inactif"}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggle(c)}
                      disabled={pending}
                      title={c.active ? "Désactiver" : "Activer"}
                      className="text-muted hover:bg-surface-2 grid size-8 place-items-center rounded-full"
                    >
                      <Power className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(c)}
                      title="Modifier"
                      className="text-muted hover:bg-surface-2 grid size-8 place-items-center rounded-full"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(c)}
                      disabled={pending}
                      title="Supprimer"
                      className="text-danger-600 hover:bg-danger-50 grid size-8 place-items-center rounded-full"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : c.id)}
                  className="text-muted hover:bg-surface-2 border-border flex w-full items-center justify-between border-t px-4 py-2 text-xs font-semibold"
                >
                  <span>Usages ({reds.length})</span>
                  <ChevronDown
                    className={cn(
                      "size-4 transition-transform",
                      open && "rotate-180"
                    )}
                  />
                </button>
                {open && (
                  <div className="border-border border-t">
                    {reds.length === 0 ? (
                      <p className="text-muted px-4 py-3 text-xs">
                        Aucun usage enregistré.
                      </p>
                    ) : (
                      <ul className="divide-border divide-y">
                        {reds.map((r) => (
                          <li
                            key={r.id}
                            className="flex items-center justify-between gap-3 px-4 py-2 text-xs"
                          >
                            <span className="min-w-0 flex-1 truncate">
                              <span className="text-foreground font-semibold">
                                {r.customers?.full_name || "Client"}
                              </span>
                              {r.customers?.phone && (
                                <span className="text-muted">
                                  {" · "}
                                  {r.customers.phone}
                                </span>
                              )}
                              {r.orders?.pickup_code && (
                                <span className="text-muted">
                                  {" · #"}
                                  {r.orders.pickup_code}
                                </span>
                              )}
                            </span>
                            <span className="text-muted shrink-0">
                              {new Date(r.created_at).toLocaleDateString(
                                "fr-DZ",
                                {
                                  day: "numeric",
                                  month: "short",
                                }
                              )}
                            </span>
                            <span className="text-danger-700 shrink-0 font-bold tabular-nums">
                              -{formatDA(r.discount_da)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {(creating || editing) && (
        <CodeForm
          initial={editing ?? emptyForm()}
          codeId={editing?.id ?? null}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulaire création/édition (drawer).
// ---------------------------------------------------------------------------
function toFormState(c: AdminPlatformCode | CodeInput): CodeInput {
  return {
    code: c.code,
    title_fr: c.title_fr,
    title_ar: c.title_ar ?? "",
    description_fr: c.description_fr ?? "",
    description_ar: c.description_ar ?? "",
    discount_kind: c.discount_kind,
    discount_value: c.discount_value,
    max_discount_da: c.max_discount_da ?? null,
    min_subtotal_da: c.min_subtotal_da ?? null,
    starts_at: ("starts_at" in c ? c.starts_at : null) ?? null,
    ends_at: ("ends_at" in c ? c.ends_at : null) ?? null,
    max_uses: c.max_uses ?? null,
    max_uses_per_customer: c.max_uses_per_customer ?? null,
    online_only: c.online_only,
    app_only: c.app_only,
    audience: c.audience,
    is_listed: c.is_listed,
    active: c.active,
  };
}

function CodeForm({
  initial,
  codeId,
  onClose,
  onSaved,
}: {
  initial: AdminPlatformCode | CodeInput;
  codeId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CodeInput>(toFormState(initial));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof CodeInput>(key: K, value: CodeInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function num(value: string): number | null {
    const n = value.trim() === "" ? null : Number(value);
    return n == null || Number.isNaN(n) ? null : n;
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = codeId
        ? await updatePlatformCode(codeId, form)
        : await createPlatformCode(form);
      if (res.error) setError(res.error);
      else onSaved();
    });
  }

  const input =
    "border-border bg-surface focus:border-primary-500 w-full rounded-[10px] border px-3 py-2 text-sm outline-none";
  const label = "text-muted mb-1 block text-xs font-semibold";

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[20px] pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-[20px] sm:pb-0">
        <header className="border-border flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-foreground text-lg font-bold">
            {codeId ? "Modifier le code" : "Nouveau code"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:bg-surface-2 rounded-full p-1.5"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <div>
            <label className={label}>Code</label>
            <input
              className={cn(input, "font-mono uppercase")}
              value={form.code}
              onChange={(e) => set("code", e.target.value.toUpperCase())}
              placeholder="BIENVENUE20"
              maxLength={40}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Titre (FR)</label>
              <input
                className={input}
                value={form.title_fr}
                onChange={(e) => set("title_fr", e.target.value)}
                maxLength={100}
              />
            </div>
            <div>
              <label className={label}>Titre (AR)</label>
              <input
                className={input}
                value={form.title_ar}
                onChange={(e) => set("title_ar", e.target.value)}
                dir="rtl"
                maxLength={100}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Type de remise</label>
              <select
                className={input}
                value={form.discount_kind}
                onChange={(e) =>
                  set("discount_kind", e.target.value as "percent" | "amount")
                }
              >
                <option value="percent">Pourcentage (%)</option>
                <option value="amount">Montant (DA)</option>
              </select>
            </div>
            <div>
              <label className={label}>Valeur</label>
              <input
                type="number"
                className={input}
                value={String(form.discount_value)}
                onChange={(e) => set("discount_value", Number(e.target.value))}
                min={0}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Plafond remise (DA)</label>
              <input
                type="number"
                className={input}
                value={
                  form.max_discount_da == null
                    ? ""
                    : String(form.max_discount_da)
                }
                onChange={(e) => set("max_discount_da", num(e.target.value))}
                placeholder="—"
              />
            </div>
            <div>
              <label className={label}>Achat min (DA)</label>
              <input
                type="number"
                className={input}
                value={
                  form.min_subtotal_da == null
                    ? ""
                    : String(form.min_subtotal_da)
                }
                onChange={(e) => set("min_subtotal_da", num(e.target.value))}
                placeholder="—"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Usages max (global)</label>
              <input
                type="number"
                className={input}
                value={form.max_uses == null ? "" : String(form.max_uses)}
                onChange={(e) => set("max_uses", num(e.target.value))}
                placeholder="∞"
              />
            </div>
            <div>
              <label className={label}>Usages / client</label>
              <input
                type="number"
                className={input}
                value={
                  form.max_uses_per_customer == null
                    ? ""
                    : String(form.max_uses_per_customer)
                }
                onChange={(e) =>
                  set("max_uses_per_customer", num(e.target.value))
                }
                placeholder="∞"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Début (optionnel)</label>
              <input
                type="datetime-local"
                className={input}
                value={form.starts_at ?? ""}
                onChange={(e) => set("starts_at", e.target.value || null)}
              />
            </div>
            <div>
              <label className={label}>Fin (optionnel)</label>
              <input
                type="datetime-local"
                className={input}
                value={form.ends_at ?? ""}
                onChange={(e) => set("ends_at", e.target.value || null)}
              />
            </div>
          </div>

          <div>
            <label className={label}>Audience</label>
            <select
              className={input}
              value={form.audience}
              onChange={(e) =>
                set("audience", e.target.value as CodeInput["audience"])
              }
            >
              <option value="public">Public (saisie libre)</option>
              <option value="targeted">Ciblé (clients attribués)</option>
              <option value="all">Tous (visible par tous)</option>
            </select>
          </div>

          <div className="space-y-2 pt-1">
            <Toggle
              checked={form.online_only}
              onChange={(v) => set("online_only", v)}
              label="Paiement en ligne uniquement"
            />
            <Toggle
              checked={form.app_only}
              onChange={(v) => set("app_only", v)}
              label="Application installée uniquement (Android/iOS, pas le site web)"
            />
            <Toggle
              checked={form.is_listed}
              onChange={(v) => set("is_listed", v)}
              label="Afficher dans le compte client (codes publics)"
            />
            <Toggle
              checked={form.active}
              onChange={(v) => set("active", v)}
              label="Actif"
            />
          </div>

          {error && (
            <p className="text-danger-700 text-sm font-medium">{error}</p>
          )}
        </div>

        <footer className="border-border flex items-center justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:bg-surface-2 rounded-[10px] px-4 py-2 text-sm font-semibold"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="bg-primary-600 hover:bg-primary-700 rounded-[10px] px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {pending ? "…" : "Enregistrer"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 text-start"
    >
      <span className="text-foreground text-sm font-medium">{label}</span>
      <span
        className={cn(
          "relative h-6 w-10 shrink-0 rounded-full transition-colors",
          checked ? "bg-primary-600" : "bg-border-strong"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white transition-all",
            checked ? "left-[18px]" : "left-0.5"
          )}
        />
      </span>
    </button>
  );
}
