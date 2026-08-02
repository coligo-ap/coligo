"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  MapPin,
  RotateCcw,
  ShieldAlert,
  Smartphone,
  Users,
} from "lucide-react";
import { usePrompt } from "@/components/ui/confirm";
import {
  applyFraudAction,
  revokeFraudAction,
} from "@/app/admin/(confiance)/anti-fraude/actions";
import {
  FRAUD_ACTION_LABEL,
  FRAUD_APPLICABLE_ACTIONS,
  FRAUD_EVENT_LABEL,
  FRAUD_KIND_LABEL,
  FRAUD_ALERT_STATUS_LABEL,
  isFraudActionActive,
  type FraudActionType,
  type FraudActorDetail,
  type FraudActorKind,
} from "@/lib/fraud/model";
import { fmtDateTime, KindBadge, ScorePill, SeverityBadge } from "./fraud-ui";

/** Mini-courbe SVG de l'évolution du risk score (série unique, marque violette). */
function RiskSparkline({ history }: { history: FraudActorDetail["history"] }) {
  if (history.length < 2) {
    return (
      <p className="text-muted text-sm">
        Pas encore assez d&apos;historique pour tracer l&apos;évolution.
      </p>
    );
  }
  const W = 560;
  const H = 96;
  const xs = history.map((_, i) => (i / (history.length - 1)) * (W - 8) + 4);
  const ys = history.map((h) => H - 6 - (h.risk / 100) * (H - 12));
  const points = xs
    .map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`)
    .join(" ");
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-24 w-full min-w-[320px]"
        role="img"
        aria-label="Évolution du risk score"
      >
        {[25, 50, 75].map((g) => {
          const y = H - 6 - (g / 100) * (H - 12);
          return (
            <line
              key={g}
              x1="4"
              x2={W - 4}
              y1={y}
              y2={y}
              stroke="#e2e8f0"
              strokeWidth="1"
            />
          );
        })}
        <polyline
          points={points}
          fill="none"
          stroke="#6C2BD9"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {history.map((h, i) => (
          <circle key={i} cx={xs[i]} cy={ys[i]} r="3" fill="#6C2BD9">
            <title>{`${fmtDateTime(h.at)} — risque ${h.risk}/100 (${h.reason ?? ""})`}</title>
          </circle>
        ))}
      </svg>
      <div className="text-muted flex justify-between text-[10px]">
        <span>{fmtDateTime(history[0].at)}</span>
        <span>{fmtDateTime(history[history.length - 1].at)}</span>
      </div>
    </div>
  );
}

function MetaChips({ meta }: { meta: Record<string, unknown> }) {
  const chips: string[] = [];
  if (meta.by) chips.push(`par : ${meta.by}`);
  if (meta.phase) chips.push(`phase : ${meta.phase}`);
  if (meta.near_dest === true || meta.near_dest === "true")
    chips.push("⚠ près destination");
  if (meta.after_contact === true || meta.after_contact === "true")
    chips.push("⚠ après contact");
  if (meta.cause) chips.push(`cause : ${meta.cause}`);
  if (meta.streak) chips.push(`série : ${meta.streak}`);
  if (chips.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span
          key={c}
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            c.startsWith("⚠")
              ? "bg-red-50 text-red-700"
              : "text-muted bg-slate-100"
          }`}
        >
          {c}
        </span>
      ))}
    </span>
  );
}

export function FraudActorView({
  kind,
  actorId,
  detail,
}: {
  kind: FraudActorKind;
  actorId: string;
  detail: FraudActorDetail | null;
}) {
  const router = useRouter();
  const promptText = usePrompt();
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const score = detail?.score ?? null;

  const apply = async (action: FraudActionType) => {
    if (pendingAction) return;
    setError(null);

    // ⚠️ La saisie du motif se fait HORS transition. Ouvrir une boîte de
    // dialogue DANS `startTransition` maintenait la transition ouverte tant que
    // l'administrateur n'avait pas répondu : `pending` restait vrai, et le
    // garde `if (pending) return` en tête de CHAQUE bouton bloquait ensuite
    // toutes les autres mesures. D'où « rien ne fonctionne sur cette page ».
    const reason = await promptText({
      title: `${FRAUD_ACTION_LABEL[action]} — motif`,
      message:
        action === "restore"
          ? "Révoque TOUTES les mesures actives et annule leurs effets."
          : "Le motif est journalisé et visible dans l'audit.",
      placeholder: "Motif (obligatoire)",
    });
    if (reason === null || reason.trim() === "") return;

    // Seul l'appel serveur entre dans la transition.
    setPendingAction(action);
    startTransition(async () => {
      const res = await applyFraudAction({
        kind,
        actorId,
        action,
        reason: reason.trim(),
      });
      setPendingAction(null);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  };

  const revoke = (actionId: string) => {
    // Même correctif : on se fie à l'action EN COURS, pas au drapeau global de
    // transition, qui pouvait rester coincé.
    if (pendingAction) return;
    setError(null);
    setPendingAction(actionId);
    startTransition(async () => {
      const res = await revokeFraudAction({ actionId });
      setPendingAction(null);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  };

  if (!detail || !score) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-5 lg:px-6">
        <Link
          href="/admin/anti-fraude/comptes"
          className="text-muted inline-flex items-center gap-1 text-sm hover:underline"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" /> Comptes
        </Link>
        <p className="text-muted mt-4 text-sm">
          Ce compte n&apos;a pas encore été évalué par le moteur (aucun score).
          Il le sera à sa prochaine activité ou lors du balayage quotidien.
        </p>
      </div>
    );
  }

  const activeActions = detail.actions.filter(isFraudActionActive);

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 lg:px-6">
      <Link
        href="/admin/anti-fraude/comptes"
        className="text-muted inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" /> Comptes à risque
      </Link>

      {/* En-tête scores */}
      <section className="border-border rounded-2xl border bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-extrabold tracking-tight">
            {score.display_name ?? "Compte"}
          </h1>
          <KindBadge kind={kind} />
          <SeverityBadge severity={score.risk_level} />
          {score.suspicious_count > 0 && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
              {score.suspicious_count} situation
              {score.suspicious_count > 1 ? "s" : ""} suspecte
              {score.suspicious_count > 1 ? "s" : ""}
            </span>
          )}
          <span className="text-muted ms-auto text-[11px]">
            Évalué {fmtDateTime(score.evaluated_at)}
          </span>
        </div>
        <div className="mt-3 flex gap-2">
          <ScorePill label="Trust score" value={score.trust_score} invert />
          <ScorePill label="Fraud score" value={score.fraud_score} />
          <ScorePill label="Risk score" value={score.risk_score} />
        </div>
        {error && (
          <p className="mt-2 text-xs font-medium text-red-600">{error}</p>
        )}
        {/* Mesures applicables */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {FRAUD_APPLICABLE_ACTIONS.filter(
            (a) => a !== "require_ack" || kind === "customer"
          ).map((a) => (
            <button
              key={a}
              type="button"
              disabled={pendingAction !== null}
              onClick={() => apply(a)}
              className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-bold transition disabled:opacity-60 ${
                a === "suspend"
                  ? "border-transparent bg-red-600 text-white hover:bg-red-700"
                  : a === "restore"
                    ? "border-transparent bg-emerald-600 text-white hover:bg-emerald-700"
                    : "border-border bg-white hover:bg-slate-50"
              }`}
            >
              {pendingAction === a && (
                <Loader2 className="size-3 animate-spin" />
              )}
              {FRAUD_ACTION_LABEL[a]}
            </button>
          ))}
        </div>
      </section>

      {/* Mesures actives */}
      {activeActions.length > 0 && (
        <section className="rounded-2xl border border-orange-200 bg-orange-50/50 p-4">
          <h2 className="text-sm font-bold">Mesures actives</h2>
          <ul className="divide-border mt-2 divide-y">
            {activeActions.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-2">
                <ShieldAlert className="size-4 shrink-0 text-orange-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {FRAUD_ACTION_LABEL[a.action]}{" "}
                    <span className="text-muted text-[11px] font-normal">
                      {a.source === "auto"
                        ? "· automatique"
                        : `· ${a.admin_email}`}
                      {" · "}
                      {fmtDateTime(a.created_at)}
                      {a.expires_at
                        ? ` · expire ${fmtDateTime(a.expires_at)}`
                        : ""}
                    </span>
                  </p>
                  <p className="text-muted truncate text-xs">{a.reason}</p>
                </div>
                <button
                  type="button"
                  disabled={pendingAction !== null}
                  onClick={() => revoke(a.id)}
                  className="border-border inline-flex shrink-0 items-center gap-1 rounded-xl border bg-white px-2.5 py-1.5 text-xs font-bold hover:bg-slate-50 disabled:opacity-60"
                >
                  {pendingAction === a.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3" />
                  )}
                  Révoquer
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Explication du score */}
      <section className="border-border rounded-2xl border bg-white p-4">
        <h2 className="text-sm font-bold">Pourquoi ce score ? (explicable)</h2>
        {score.components.length === 0 ? (
          <p className="text-muted mt-2 text-sm">Aucune règle évaluée.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-muted border-border border-b text-[11px]">
                  <th className="py-1.5 text-start font-semibold">Règle</th>
                  <th className="text-end font-semibold">Mesuré</th>
                  <th className="text-end font-semibold">Seuil</th>
                  <th className="text-end font-semibold">Poids appris</th>
                  <th className="text-end font-semibold">Points</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {[...score.components]
                  .sort((a, b) => b.points - a.points)
                  .map((c) => (
                    <tr
                      key={c.rule}
                      className={c.triggered ? "bg-red-50/40" : undefined}
                    >
                      <td className="py-2 pe-2">
                        <span className="font-medium">{c.label}</span>{" "}
                        <span className="text-muted text-[11px]">{c.rule}</span>
                      </td>
                      <td className="text-end tabular-nums">{c.value}</td>
                      <td className="text-muted text-end tabular-nums">
                        {c.threshold}
                      </td>
                      <td className="text-muted text-end tabular-nums">
                        ×{c.weight_mult}
                      </td>
                      <td
                        className={`text-end font-bold tabular-nums ${
                          c.points > 0 ? "text-red-700" : "text-muted"
                        }`}
                      >
                        {c.points > 0 ? `+${c.points}` : "0"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Évolution */}
      <section className="border-border rounded-2xl border bg-white p-4">
        <h2 className="mb-2 text-sm font-bold">
          Évolution du risk score (90 j)
        </h2>
        <RiskSparkline history={detail.history} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Alertes du compte */}
        <section className="border-border rounded-2xl border bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Alertes</h2>
            <Link
              href="/admin/anti-fraude/alertes"
              className="text-accent text-xs font-semibold hover:underline"
            >
              Les traiter
            </Link>
          </div>
          {detail.alerts.length === 0 ? (
            <p className="text-muted mt-2 text-sm">Aucune alerte.</p>
          ) : (
            <ul className="divide-border mt-1 divide-y">
              {detail.alerts.map((a) => (
                <li key={a.id} className="flex items-center gap-2 py-2">
                  <SeverityBadge severity={a.severity} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {a.title}
                  </span>
                  <span className="text-muted shrink-0 text-[11px]">
                    {FRAUD_ALERT_STATUS_LABEL[a.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Historique des mesures */}
        <section className="border-border rounded-2xl border bg-white p-4">
          <h2 className="text-sm font-bold">Journal des mesures</h2>
          {detail.actions.length === 0 ? (
            <p className="text-muted mt-2 text-sm">Aucune mesure.</p>
          ) : (
            <ul className="divide-border mt-1 divide-y">
              {detail.actions.map((a) => (
                <li key={a.id} className="py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">
                      {FRAUD_ACTION_LABEL[a.action]}
                    </span>
                    <span className="text-muted text-[11px]">
                      {a.source === "auto" ? "auto" : a.admin_email} ·{" "}
                      {fmtDateTime(a.created_at)}
                    </span>
                    {a.revoked_at && (
                      <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                        révoquée
                      </span>
                    )}
                  </div>
                  <p className="text-muted truncate text-xs">{a.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Timeline des événements */}
      <section className="border-border rounded-2xl border bg-white p-4">
        <h2 className="text-sm font-bold">Timeline des événements</h2>
        {detail.events.length === 0 ? (
          <p className="text-muted mt-2 text-sm">
            Aucun événement capturé pour ce compte.
          </p>
        ) : (
          <ul className="divide-border mt-1 divide-y">
            {detail.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="text-muted w-24 shrink-0 text-[11px] tabular-nums">
                  {fmtDateTime(e.created_at)}
                </span>
                <span className="text-sm font-semibold">
                  {FRAUD_EVENT_LABEL[e.event_type] ?? e.event_type}
                </span>
                <MetaChips meta={e.meta} />
                {e.order_id && (
                  <Link
                    href={`/admin/orders?focus=${e.order_id}`}
                    className="text-accent text-[11px] font-semibold hover:underline"
                  >
                    commande
                  </Link>
                )}
                {e.ride_id && (
                  <Link
                    href={`/admin/chauffeurs/courses?focus=${e.ride_id}`}
                    className="text-accent text-[11px] font-semibold hover:underline"
                  >
                    course
                  </Link>
                )}
                {e.lat != null && (
                  <span className="text-muted inline-flex items-center gap-0.5 text-[11px]">
                    <MapPin className="size-3" />
                    {e.lat.toFixed(4)}, {e.lng?.toFixed(4)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Appareils */}
        <section className="border-border rounded-2xl border bg-white p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-bold">
            <Smartphone className="size-4" /> Appareils & IP
          </h2>
          {detail.devices.length === 0 ? (
            <p className="text-muted mt-2 text-sm">Aucun appareil tracé.</p>
          ) : (
            <ul className="divide-border mt-1 divide-y">
              {detail.devices.map((d, i) => (
                <li key={i} className="py-2 text-sm">
                  <span className="font-mono text-xs font-semibold">
                    {d.ip}
                  </span>
                  <span className="text-muted ms-2 text-[11px]">
                    {[d.platform, d.city, d.country]
                      .filter(Boolean)
                      .join(" · ")}
                    {d.is_standalone ? " · App" : ""} · {d.hits} sessions ·{" "}
                    {fmtDateTime(d.last_seen_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Comptes liés */}
        <section className="border-border rounded-2xl border bg-white p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-bold">
            <Users className="size-4" /> Comptes liés (mêmes IP, 30 j)
          </h2>
          {detail.linked_accounts.length === 0 ? (
            <p className="text-muted mt-2 text-sm">Aucun compte lié détecté.</p>
          ) : (
            <ul className="divide-border mt-1 divide-y">
              {detail.linked_accounts.map((l, i) => (
                <li key={i} className="py-2 text-sm">
                  <span className="font-semibold">{l.email ?? l.user_id}</span>
                  <span className="text-muted ms-2 text-[11px]">
                    {l.role ?? "?"} · {l.ip} · {fmtDateTime(l.last_seen_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="text-muted text-center text-[11px]">
        {FRAUD_KIND_LABEL[kind]} · toutes les mesures sont réversibles et
        journalisées (audit complet).
      </p>
    </div>
  );
}
