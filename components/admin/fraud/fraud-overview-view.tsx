"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  Gauge,
  PowerOff,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import {
  FRAUD_KIND_LABEL,
  FRAUD_SEVERITY_META,
  FRAUD_SOURCE_COLOR,
  fraudActorHref,
  type FraudOverview,
  type FraudSeverity,
} from "@/lib/fraud/model";
import { fmtDay, SeverityBadge, KindBadge } from "./fraud-ui";

const SEV_ORDER: FraudSeverity[] = ["low", "medium", "high", "critical"];

function Kpi({
  icon: Icon,
  label,
  value,
  href,
  accent = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  href?: string;
  accent?: boolean;
}) {
  const body = (
    <div
      className={`border-border rounded-2xl border bg-white p-3 transition-shadow ${
        accent && value > 0 ? "border-red-200 bg-red-50/50" : ""
      }`}
    >
      <div className="flex items-center gap-1.5">
        <Icon
          className={`size-4 ${accent && value > 0 ? "text-red-600" : "text-muted"}`}
        />
        <span className="text-muted text-caption font-semibold">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums">{value}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/** Colonnes empilées par gravité — segments espacés de 2px, compteur total
 *  au-dessus de chaque colonne (relief exigé par la palette de statut). */
function StackedDays({ days }: { days: FraudOverview["alerts_by_day"] }) {
  const max = Math.max(
    1,
    ...days.map((d) => d.low + d.medium + d.high + d.critical)
  );
  return (
    <div>
      <div className="flex h-40 items-end gap-1.5">
        {days.map((d) => {
          const total = d.low + d.medium + d.high + d.critical;
          return (
            <div
              key={d.d}
              className="flex min-w-0 flex-1 flex-col items-center justify-end gap-0.5"
              title={`${fmtDay(d.d)} — ${total} alerte${total > 1 ? "s" : ""}`}
            >
              {total > 0 && (
                <span className="text-muted text-micro font-semibold tabular-nums">
                  {total}
                </span>
              )}
              <div className="flex w-full max-w-7 flex-col-reverse gap-[2px]">
                {SEV_ORDER.map((sev) => {
                  const v = d[sev];
                  if (!v) return null;
                  return (
                    <div
                      key={sev}
                      className="w-full rounded-[3px]"
                      style={{
                        height: Math.max(4, (v / max) * 128),
                        backgroundColor: FRAUD_SEVERITY_META[sev].color,
                      }}
                      title={`${FRAUD_SEVERITY_META[sev].label} : ${v}`}
                    />
                  );
                })}
              </div>
              <span className="text-muted text-nano">{fmtDay(d.d)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {SEV_ORDER.map((sev) => (
          <span
            key={sev}
            className="text-muted text-caption flex items-center gap-1.5"
          >
            <span
              className="inline-block size-2.5 rounded-[3px]"
              style={{ backgroundColor: FRAUD_SEVERITY_META[sev].color }}
            />
            {FRAUD_SEVERITY_META[sev].label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Répartition des niveaux de risque par population (barres horizontales). */
function RiskDistribution({
  rows,
}: {
  rows: FraudOverview["risk_distribution"];
}) {
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const total = r.low + r.medium + r.high + r.critical;
        if (total === 0) return null;
        return (
          <div key={r.kind}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-semibold">{FRAUD_KIND_LABEL[r.kind]}</span>
              <span className="text-muted tabular-nums">{total} évalués</span>
            </div>
            <div className="flex h-3.5 gap-[2px] overflow-hidden rounded-md">
              {SEV_ORDER.map((sev) => {
                const v = r[sev];
                if (!v) return null;
                return (
                  <div
                    key={sev}
                    style={{
                      width: `${(v / total) * 100}%`,
                      backgroundColor: FRAUD_SEVERITY_META[sev].color,
                    }}
                    title={`${FRAUD_SEVERITY_META[sev].label} : ${v}`}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
      {rows.every((r) => r.low + r.medium + r.high + r.critical === 0) && (
        <p className="text-muted text-sm">
          Aucun compte évalué pour l&apos;instant.
        </p>
      )}
    </div>
  );
}

export function FraudOverviewView({
  overview,
}: {
  overview: FraudOverview | null;
}) {
  if (!overview) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-5 lg:px-6">
        <p className="text-muted text-sm">
          Impossible de charger le Centre Anti-Fraude. Recharge la page.
        </p>
      </div>
    );
  }
  const k = overview.kpis;
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 lg:px-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi
          icon={ShieldAlert}
          label="Alertes ouvertes"
          value={k.alerts_open}
          href="/admin/anti-fraude/alertes"
        />
        <Kpi
          icon={AlertTriangle}
          label="Critiques"
          value={k.alerts_critical}
          href="/admin/anti-fraude/alertes"
          accent
        />
        <Kpi
          icon={Gauge}
          label="Comptes à risque"
          value={k.high_risk}
          href="/admin/anti-fraude/comptes"
          accent
        />
        <Kpi icon={Sparkles} label="Mesures (7 j)" value={k.actions_7d} />
        <Kpi
          icon={PowerOff}
          label="Auto hors ligne (24 h)"
          value={k.auto_offline_24h}
        />
        <Kpi icon={Bell} label="Popups en attente" value={k.acks_pending} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Alertes 14 j */}
        <section className="border-border rounded-2xl border bg-white p-4">
          <h2 className="mb-3 text-sm font-bold">Alertes par jour (14 j)</h2>
          {overview.alerts_by_day.length === 0 ? (
            <p className="text-muted text-sm">Aucune alerte sur la période.</p>
          ) : (
            <StackedDays days={overview.alerts_by_day} />
          )}
        </section>

        {/* Actions 14 j */}
        <section className="border-border rounded-2xl border bg-white p-4">
          <h2 className="mb-3 text-sm font-bold">Mesures par jour (14 j)</h2>
          {overview.actions_by_day.length === 0 ? (
            <p className="text-muted text-sm">Aucune mesure sur la période.</p>
          ) : (
            <div>
              <div className="flex h-40 items-end gap-1.5">
                {overview.actions_by_day.map((d) => {
                  const max = Math.max(
                    1,
                    ...overview.actions_by_day.map((x) => x.auto + x.admin)
                  );
                  const total = d.auto + d.admin;
                  return (
                    <div
                      key={d.d}
                      className="flex min-w-0 flex-1 flex-col items-center justify-end gap-0.5"
                      title={`${fmtDay(d.d)} — auto ${d.auto} · équipe ${d.admin}`}
                    >
                      {total > 0 && (
                        <span className="text-muted text-micro font-semibold tabular-nums">
                          {total}
                        </span>
                      )}
                      <div className="flex w-full max-w-7 flex-col-reverse gap-[2px]">
                        {d.auto > 0 && (
                          <div
                            className="w-full rounded-[3px]"
                            style={{
                              height: Math.max(4, (d.auto / max) * 128),
                              backgroundColor: FRAUD_SOURCE_COLOR.auto,
                            }}
                          />
                        )}
                        {d.admin > 0 && (
                          <div
                            className="w-full rounded-[3px]"
                            style={{
                              height: Math.max(4, (d.admin / max) * 128),
                              backgroundColor: FRAUD_SOURCE_COLOR.admin,
                            }}
                          />
                        )}
                      </div>
                      <span className="text-muted text-nano">
                        {fmtDay(d.d)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <span className="text-muted text-caption flex items-center gap-1.5">
                  <span
                    className="inline-block size-2.5 rounded-[3px]"
                    style={{ backgroundColor: FRAUD_SOURCE_COLOR.auto }}
                  />
                  Automatiques
                </span>
                <span className="text-muted text-caption flex items-center gap-1.5">
                  <span
                    className="inline-block size-2.5 rounded-[3px]"
                    style={{ backgroundColor: FRAUD_SOURCE_COLOR.admin }}
                  />
                  Équipe Coligo
                </span>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Répartition des risques */}
      <section className="border-border rounded-2xl border bg-white p-4">
        <h2 className="mb-3 text-sm font-bold">
          Niveaux de risque par population
        </h2>
        <RiskDistribution rows={overview.risk_distribution} />
      </section>

      {/* Top comptes à risque */}
      <section className="border-border rounded-2xl border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">Comptes les plus à risque</h2>
          <Link
            href="/admin/anti-fraude/comptes"
            className="text-accent text-xs font-semibold hover:underline"
          >
            Tout voir
          </Link>
        </div>
        {overview.top_risk.length === 0 ? (
          <p className="text-muted text-sm">Aucun compte évalué.</p>
        ) : (
          <ul className="divide-border divide-y">
            {overview.top_risk.map((t) => (
              <li key={`${t.actor_kind}-${t.actor_id}`}>
                <Link
                  href={fraudActorHref(t.actor_kind, t.actor_id)}
                  className="flex items-center gap-3 py-2.5 hover:bg-slate-50"
                >
                  <Users className="text-muted size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {t.display_name ?? "Compte"}
                  </span>
                  <KindBadge kind={t.actor_kind} />
                  <SeverityBadge severity={t.level} />
                  <span className="w-14 text-end text-sm font-extrabold tabular-nums">
                    {t.risk}/100
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Apprentissage */}
      <section className="border-border rounded-2xl border bg-white p-4">
        <h2 className="text-sm font-bold">Apprentissage du moteur</h2>
        <p className="text-muted mt-0.5 text-xs">
          Chaque verdict (fraude confirmée / faux positif) ajuste le poids futur
          de la règle. ×1 = poids d&apos;origine.
        </p>
        {overview.rules_learning.length === 0 ? (
          <p className="text-muted mt-3 text-sm">
            Aucune règle déclenchée pour l&apos;instant.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-muted border-border text-caption border-b text-start">
                  <th className="py-1.5 text-start font-semibold">Règle</th>
                  <th className="text-end font-semibold">Déclenchée</th>
                  <th className="text-end font-semibold">Confirmées</th>
                  <th className="text-end font-semibold">Faux positifs</th>
                  <th className="text-end font-semibold">Poids appris</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {overview.rules_learning.map((r) => (
                  <tr key={r.code}>
                    <td className="py-2 pe-2">
                      <span className="font-medium">{r.label}</span>{" "}
                      <span className="text-muted text-caption">{r.code}</span>
                    </td>
                    <td className="text-end tabular-nums">{r.hits}</td>
                    <td className="text-end text-emerald-700 tabular-nums">
                      {r.confirmed}
                    </td>
                    <td className="text-end text-red-600 tabular-nums">
                      {r.dismissed}
                    </td>
                    <td className="text-end font-bold tabular-nums">
                      ×{r.weight_mult}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
