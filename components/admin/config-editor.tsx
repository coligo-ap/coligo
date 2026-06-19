"use client";

import { useState, useTransition } from "react";
import {
  updateConfigValue,
  fetchKeyHistory,
  type ConfigActionState,
} from "@/app/admin/config/actions";
import type {
  ConfigItem,
  ConfigHistoryEntry,
} from "@/lib/data/config-registry";

const GROUP_LABELS: Record<string, string> = {
  commissions: "Commissions",
  cashback: "Cashback",
  livraison: "Livraison & tournée",
  recharge: "Recharge",
  retrait: "Retrait",
  abonnements: "Abonnements",
};

export function ConfigEditor({ items }: { items: ConfigItem[] }) {
  const groups = Array.from(new Set(items.map((i) => i.group)));
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g}>
          <h2 className="text-muted mb-2 text-xs font-bold tracking-wide uppercase">
            {GROUP_LABELS[g] ?? g}
          </h2>
          <div className="border-border divide-border divide-y rounded-2xl border bg-white">
            {items
              .filter((i) => i.group === g)
              .map((item) => (
                <ConfigRow key={item.key} item={item} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function fmtVal(item: ConfigItem): string {
  if (item.valueType === "rate")
    return `${(Number(item.value) * 100).toFixed(2)} %`;
  if (item.valueType === "bool") return item.value ? "Activé" : "Désactivé";
  if (item.valueType === "json") return "—";
  return String(item.value ?? "");
}

function ConfigRow({ item }: { item: ConfigItem }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ConfigActionState>({});
  const [pending, start] = useTransition();
  const [history, setHistory] = useState<ConfigHistoryEntry[] | null>(null);

  // état local d'édition (forme d'affichage)
  const [num, setNum] = useState<string>(
    item.valueType === "rate"
      ? String(Number(item.value) * 100)
      : String(item.value ?? "")
  );
  const [bool, setBool] = useState<boolean>(Boolean(item.value));
  const [rows, setRows] = useState<Record<string, unknown>[]>(
    Array.isArray(item.value) ? (item.value as Record<string, unknown>[]) : []
  );

  function save() {
    setState({});
    let payload: unknown;
    if (item.valueType === "bool") payload = bool;
    else if (item.valueType === "json") payload = rows;
    else {
      const n = Number(num);
      payload = item.valueType === "rate" ? n / 100 : n;
    }
    start(async () => {
      const res = await updateConfigValue(item.key, payload);
      setState(res);
    });
  }

  function loadHistory() {
    setOpen((o) => !o);
    if (history === null) {
      start(async () => setHistory(await fetchKeyHistory(item.key)));
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-foreground text-sm font-semibold">
            {item.labelFr}
          </p>
          {item.helpFr && (
            <p className="text-muted mt-0.5 text-xs leading-snug">
              {item.helpFr}
            </p>
          )}
          <p className="text-muted/70 mt-1 font-mono text-[11px]">{item.key}</p>
        </div>
        <button
          type="button"
          onClick={loadHistory}
          className="text-primary-600 shrink-0 text-xs font-semibold hover:underline"
        >
          Historique
        </button>
      </div>

      {/* éditeur selon le type */}
      <div className="mt-3">
        {item.valueType === "bool" ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={bool}
              onChange={(e) => setBool(e.target.checked)}
              className="size-4"
            />
            {bool ? "Activé" : "Désactivé"}
          </label>
        ) : item.valueType === "json" ? (
          <TierEditor item={item} rows={rows} setRows={setRows} />
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={num}
              step={item.stepNum ?? (item.valueType === "rate" ? 0.1 : 1)}
              onChange={(e) => setNum(e.target.value)}
              className="border-border w-40 rounded-lg border px-3 py-1.5 text-sm"
            />
            <span className="text-muted text-sm">
              {item.valueType === "rate" ? "%" : "DA / valeur"}
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="bg-primary-600 rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "…" : "Enregistrer"}
        </button>
        {state.ok && (
          <span className="text-sm font-medium text-emerald-600">
            Enregistré ✓
          </span>
        )}
        {state.error && (
          <span className="text-danger-600 text-sm font-medium">
            {state.error}
          </span>
        )}
      </div>

      {open && (
        <div className="border-border bg-surface-2/50 mt-3 rounded-lg border p-3">
          <p className="text-muted mb-2 text-xs font-bold">
            Changements récents de cette clé
          </p>
          {history === null ? (
            <p className="text-muted text-xs">Chargement…</p>
          ) : history.length === 0 ? (
            <p className="text-muted text-xs">Aucun changement enregistré.</p>
          ) : (
            <ul className="space-y-1.5">
              {history.map((h, i) => (
                <li key={i} className="text-xs">
                  <span className="text-muted">
                    {new Date(h.at).toLocaleString("fr-DZ")}
                  </span>{" "}
                  {h.byEmail ? `· ${h.byEmail} ` : ""}—{" "}
                  <span className="font-mono">
                    {JSON.stringify(h.before)} → {JSON.stringify(h.after)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TierEditor({
  item,
  rows,
  setRows,
}: {
  item: ConfigItem;
  rows: Record<string, unknown>[];
  setRows: (r: Record<string, unknown>[]) => void;
}) {
  const fields = item.jsonShape?.fields ?? [];
  const itemLabel = item.jsonShape?.item_label_fr ?? "Palier";

  function update(i: number, name: string, val: string) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, [name]: val } : r));
    setRows(next);
  }
  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          {fields.map((f) => (
            <label key={f.name} className="text-xs">
              <span className="text-muted block">{f.label_fr}</span>
              <input
                type="number"
                value={
                  row[f.name] === null || row[f.name] === undefined
                    ? ""
                    : String(row[f.name])
                }
                onChange={(e) => update(i, f.name, e.target.value)}
                className="border-border w-28 rounded-lg border px-2 py-1 text-sm"
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
            className="text-danger-600 px-1 pb-1 text-xs hover:underline"
          >
            Retirer
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows([...rows, {}])}
        className="text-primary-600 text-xs font-semibold hover:underline"
      >
        + Ajouter un {itemLabel.toLowerCase()}
      </button>
    </div>
  );
}
