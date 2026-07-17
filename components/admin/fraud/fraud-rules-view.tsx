"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import {
  updateFraudRule,
  updateFraudSetting,
} from "@/app/admin/(confiance)/anti-fraude/actions";
import {
  FRAUD_KIND_LABEL,
  type FraudRuleRow,
  type FraudSettingRow,
} from "@/lib/fraud/model";
import { SeverityBadge } from "./fraud-ui";

/** Une règle — édition locale (poids + seuils JSON + activation). */
function RuleCard({ rule }: { rule: FraudRuleRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [weight, setWeight] = useState(String(rule.base_weight));
  const [params, setParams] = useState(JSON.stringify(rule.params));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = (enabled?: boolean) => {
    if (pending) return;
    setMsg(null);
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(params || "{}") as Record<string, unknown>;
    } catch {
      setMsg({ ok: false, text: "Seuils : JSON invalide." });
      return;
    }
    const w = Number(weight);
    if (!Number.isFinite(w) || w < 0 || w > 100) {
      setMsg({ ok: false, text: "Poids : nombre entre 0 et 100." });
      return;
    }
    startTransition(async () => {
      const res = await updateFraudRule({
        code: rule.code,
        enabled: enabled ?? rule.enabled,
        baseWeight: w,
        params: parsed,
      });
      if (res.error) setMsg({ ok: false, text: res.error });
      else {
        setMsg({ ok: true, text: "Enregistré." });
        router.refresh();
      }
    });
  };

  const precision =
    rule.confirmed_hits + rule.dismissed_hits > 0
      ? Math.round(
          (rule.confirmed_hits / (rule.confirmed_hits + rule.dismissed_hits)) *
            100
        )
      : null;

  return (
    <div
      className={`border-border rounded-2xl border bg-white p-3 ${
        rule.enabled ? "" : "opacity-60"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">{rule.label}</span>
        <span className="text-muted text-[11px]">{rule.code}</span>
        <SeverityBadge severity={rule.severity} />
        <span className="text-muted ms-auto text-[11px] tabular-nums">
          {rule.hits} déclenchements
          {precision != null ? ` · précision ${precision} %` : ""}
        </span>
        {/* Activation : état LOCAL par règle, jamais global */}
        <button
          type="button"
          disabled={pending}
          onClick={() => save(!rule.enabled)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            rule.enabled ? "bg-accent" : "bg-slate-300"
          }`}
          aria-label={rule.enabled ? "Désactiver" : "Activer"}
        >
          <span
            className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
              rule.enabled ? "start-[22px]" : "start-0.5"
            }`}
          />
        </button>
      </div>
      <p className="text-muted mt-1 text-xs leading-snug">{rule.description}</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-muted text-[11px] font-semibold">
          Poids
          <input
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            inputMode="decimal"
            className="border-border mt-0.5 block w-20 rounded-lg border bg-white px-2 py-1.5 text-sm font-semibold tabular-nums outline-none focus:border-slate-400"
          />
        </label>
        <label className="text-muted min-w-0 flex-1 text-[11px] font-semibold">
          Seuils (JSON)
          <input
            value={params}
            onChange={(e) => setParams(e.target.value)}
            className="border-border mt-0.5 block w-full rounded-lg border bg-white px-2 py-1.5 font-mono text-xs outline-none focus:border-slate-400"
          />
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={() => save()}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
          Enregistrer
        </button>
      </div>
      {msg && (
        <p
          className={`mt-1.5 text-xs font-medium ${
            msg.ok ? "text-emerald-700" : "text-red-600"
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}

function SettingRow({ setting }: { setting: FraudSettingRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(JSON.stringify(setting.value));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = () => {
    if (pending) return;
    setMsg(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      setMsg({
        ok: false,
        text: "Valeur invalide (JSON : nombre, true/false…).",
      });
      return;
    }
    startTransition(async () => {
      const res = await updateFraudSetting({ key: setting.key, value: parsed });
      if (res.error) setMsg({ ok: false, text: res.error });
      else {
        setMsg({ ok: true, text: "Enregistré." });
        router.refresh();
      }
    });
  };

  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{setting.label || setting.key}</p>
        <p className="text-muted font-mono text-[11px]">{setting.key}</p>
        {msg && (
          <p
            className={`text-xs font-medium ${
              msg.ok ? "text-emerald-700" : "text-red-600"
            }`}
          >
            {msg.text}
          </p>
        )}
      </div>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="border-border w-28 rounded-lg border bg-white px-2 py-1.5 text-end font-mono text-sm outline-none focus:border-slate-400"
      />
      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-3.5" />
        )}
        OK
      </button>
    </li>
  );
}

const KIND_ORDER: FraudRuleRow["actor_kind"][] = [
  "customer",
  "driver",
  "chauffeur",
  "merchant",
  "all",
];

export function FraudRulesView({
  rules,
  settings,
}: {
  rules: FraudRuleRow[];
  settings: FraudSettingRow[];
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 lg:px-6">
      {/* Réglages du moteur */}
      <section className="border-border rounded-2xl border bg-white p-4">
        <h2 className="text-sm font-bold">Réglages du moteur</h2>
        <p className="text-muted mt-0.5 text-xs">
          Seuils d&apos;automatisation (popup client, déconnexions,
          avertissement / limitation / suspension). La suspension automatique
          est désactivée par défaut — le moteur RECOMMANDE, l&apos;équipe
          décide.
        </p>
        <ul className="divide-border mt-2 divide-y">
          {settings.map((s) => (
            <SettingRow key={s.key} setting={s} />
          ))}
        </ul>
      </section>

      {/* Règles par population */}
      {KIND_ORDER.map((k) => {
        const group = rules.filter((r) => r.actor_kind === k);
        if (group.length === 0) return null;
        return (
          <section key={k} className="space-y-2">
            <h2 className="text-muted px-1 text-xs font-bold tracking-wide uppercase">
              {k === "all"
                ? "Transverses (collusion, anomalies, système)"
                : FRAUD_KIND_LABEL[k]}
            </h2>
            {group.map((r) => (
              <RuleCard key={r.code} rule={r} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
