"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import {
  FRAUD_KIND_LABEL,
  FRAUD_KINDS,
  fraudActorHref,
  type FraudActorKind,
  type FraudScoreRow,
} from "@/lib/fraud/model";
import { fmtDateTime, KindBadge, ScorePill, SeverityBadge } from "./fraud-ui";

export function FraudAccountsView({ initial }: { initial: FraudScoreRow[] }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<FraudActorKind | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return initial.filter(
      (s) =>
        (!kind || s.actor_kind === kind) &&
        (!needle || (s.display_name ?? "").toLowerCase().includes(needle))
    );
  }, [initial, q, kind]);

  return (
    <div className="mx-auto max-w-5xl space-y-3 px-4 py-5 lg:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="border-border flex min-w-0 flex-1 items-center gap-2 rounded-xl border bg-white px-3 py-2">
          <Search className="text-muted size-4 shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un nom…"
            className="placeholder:text-muted w-full bg-transparent text-sm outline-none"
          />
        </div>
        <div className="scrollbar-hide flex items-center gap-1.5 overflow-x-auto">
          {FRAUD_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(kind === k ? null : k)}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                kind === k
                  ? "border-transparent bg-slate-900 text-white"
                  : "border-border text-muted bg-white hover:bg-slate-50"
              }`}
            >
              {FRAUD_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="border-border rounded-2xl border bg-white p-8 text-center">
          <p className="text-muted text-sm">
            Aucun compte évalué{" "}
            {q || kind ? "dans ce filtre" : "pour l'instant"}.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((s) => (
            <li key={`${s.actor_kind}-${s.actor_id}`}>
              <Link
                href={fraudActorHref(s.actor_kind, s.actor_id)}
                className="border-border flex items-center gap-3 rounded-2xl border bg-white p-3 transition-shadow"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-bold">
                      {s.display_name ?? "Compte"}
                    </span>
                    <KindBadge kind={s.actor_kind} />
                    <SeverityBadge severity={s.risk_level} />
                    {s.suspicious_count > 0 && (
                      <span className="text-micro rounded-full bg-red-50 px-2 py-0.5 font-bold text-red-700">
                        {s.suspicious_count} situation
                        {s.suspicious_count > 1 ? "s" : ""} suspecte
                        {s.suspicious_count > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-muted text-caption mt-0.5">
                    Évalué {fmtDateTime(s.evaluated_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <ScorePill label="Confiance" value={s.trust_score} invert />
                  <ScorePill label="Fraude" value={s.fraud_score} />
                  <ScorePill label="Risque" value={s.risk_score} />
                </div>
                <ChevronRight className="text-muted size-4 shrink-0 rtl:rotate-180" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
