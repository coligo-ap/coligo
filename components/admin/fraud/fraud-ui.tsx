"use client";

import {
  FRAUD_KIND_LABEL,
  FRAUD_SEVERITY_META,
  type FraudActorKind,
  type FraudSeverity,
} from "@/lib/fraud/model";

/** Formatage date/heure MANUEL depuis l'ISO, en heure d'ALGER (UTC+1 fixe,
 *  pas de DST) via les getters UTC. ⚠️ getDate()/getHours() dépendent du
 *  FUSEAU DU RUNTIME : serveur Vercel = UTC, navigateur = Alger → textes
 *  différents d'une heure ⇒ hydratation #418 (bug vécu sur les pages
 *  anti-fraude). Toujours un fuseau FIXE dans un composant rendu des deux
 *  côtés. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() + 3600_000); // UTC → Alger (+1)
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function fmtDay(isoDay: string): string {
  const [, m, d] = isoDay.split("-");
  return `${d}/${m}`;
}

export function SeverityBadge({ severity }: { severity: FraudSeverity }) {
  const meta = FRAUD_SEVERITY_META[severity] ?? FRAUD_SEVERITY_META.low;
  return (
    <span
      className={`text-caption inline-flex items-center rounded-full border px-2.5 py-0.5 font-bold ${meta.badge}`}
    >
      {meta.label}
    </span>
  );
}

export function KindBadge({ kind }: { kind: FraudActorKind }) {
  return (
    <span className="border-border text-muted text-caption inline-flex items-center rounded-full border bg-white px-2.5 py-0.5 font-semibold">
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
      <div className="text-micro font-semibold opacity-80">{label}</div>
    </div>
  );
}
