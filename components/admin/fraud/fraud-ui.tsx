"use client";

import {
  FRAUD_KIND_LABEL,
  FRAUD_SEVERITY_META,
  type FraudActorKind,
  type FraudSeverity,
} from "@/lib/fraud/model";

/** Formatage date/heure MANUEL depuis l'ISO (pas d'Intl → zéro risque
 *  d'hydratation, cf. leçon merchant-ui). */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDay(isoDay: string): string {
  const [, m, d] = isoDay.split("-");
  return `${d}/${m}`;
}

export function SeverityBadge({ severity }: { severity: FraudSeverity }) {
  const meta = FRAUD_SEVERITY_META[severity] ?? FRAUD_SEVERITY_META.low;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${meta.badge}`}
    >
      {meta.label}
    </span>
  );
}

export function KindBadge({ kind }: { kind: FraudActorKind }) {
  return (
    <span className="border-border text-muted inline-flex items-center rounded-full border bg-white px-2.5 py-0.5 text-[11px] font-semibold">
      {FRAUD_KIND_LABEL[kind] ?? kind}
    </span>
  );
}

/** Pastille de score 0-100 colorée par gravité croissante. */
export function ScorePill({
  label,
  value,
  invert = false,
}: {
  label: string;
  value: number;
  /** true = un score HAUT est BON (trust). */
  invert?: boolean;
}) {
  const bad = invert ? 100 - value : value;
  const cls =
    bad >= 75
      ? "bg-red-50 text-red-700"
      : bad >= 50
        ? "bg-orange-50 text-orange-800"
        : bad >= 25
          ? "bg-amber-50 text-amber-800"
          : "bg-emerald-50 text-emerald-700";
  return (
    <div className={`rounded-xl px-3 py-1.5 text-center ${cls}`}>
      <div className="text-base leading-tight font-extrabold tabular-nums">
        {value}
      </div>
      <div className="text-[10px] font-semibold opacity-80">{label}</div>
    </div>
  );
}
