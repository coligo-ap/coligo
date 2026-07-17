"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Search, XCircle } from "lucide-react";
import { usePrompt } from "@/components/ui/confirm";
import { reviewFraudAlert } from "@/app/admin/(confiance)/anti-fraude/actions";
import {
  FRAUD_ALERT_STATUS_LABEL,
  FRAUD_KIND_LABEL,
  FRAUD_KINDS,
  FRAUD_SEVERITIES,
  FRAUD_SEVERITY_META,
  fraudActorHref,
  type FraudAlertRow,
  type FraudActorKind,
  type FraudSeverity,
} from "@/lib/fraud/model";
import { fmtDateTime, KindBadge, SeverityBadge } from "./fraud-ui";

type StatusFilter = "open_all" | "confirmed" | "dismissed";

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
        active
          ? "border-transparent bg-slate-900 text-white"
          : "border-border text-muted bg-white hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

/** Une alerte — verdict par élément (pending LOCAL, jamais global). */
function AlertCard({ alert }: { alert: FraudAlertRow }) {
  const router = useRouter();
  const promptText = usePrompt();
  const [pending, startTransition] = useTransition();
  const [verdictPending, setVerdictPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = alert.status === "open" || alert.status === "investigating";

  const review = (verdict: "confirmed" | "dismissed" | "investigating") => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      setVerdictPending(verdict);
      let note: string | null = null;
      if (verdict !== "investigating") {
        note = await promptText({
          title:
            verdict === "confirmed"
              ? "Confirmer la fraude"
              : "Classer en faux positif",
          message:
            verdict === "confirmed"
              ? "Le poids de cette règle AUGMENTERA pour les prochains scores."
              : "Le poids de cette règle DIMINUERA (moins de faux positifs).",
          placeholder: "Note interne (optionnel)",
        });
        if (note === null) {
          setVerdictPending(null);
          return; // annulé
        }
      }
      const res = await reviewFraudAlert({
        alertId: alert.id,
        verdict,
        note: note || null,
      });
      setVerdictPending(null);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <li className="border-border rounded-2xl border bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={alert.severity} />
        <KindBadge kind={alert.actor_kind} />
        <span className="min-w-0 flex-1 truncate text-sm font-bold">
          {alert.title}
        </span>
        <span className="text-muted text-[11px] tabular-nums">
          {fmtDateTime(alert.last_seen_at)}
        </span>
      </div>
      <div className="text-muted mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <Link
          href={fraudActorHref(alert.actor_kind, alert.actor_id)}
          className="text-accent inline-flex items-center gap-1 font-semibold hover:underline"
        >
          <Search className="size-3.5" />
          {alert.display_name ?? "Compte"}
        </Link>
        {alert.evidence?.value != null && (
          <span>
            mesuré <b className="text-foreground">{alert.evidence.value}</b>
            {" · seuil "}
            <b className="text-foreground">{alert.evidence.threshold}</b>
          </span>
        )}
        {alert.occurrences > 1 && <span>×{alert.occurrences} occurrences</span>}
        {!open && (
          <span className="font-semibold">
            {FRAUD_ALERT_STATUS_LABEL[alert.status]}
            {alert.reviewed_by_email ? ` — ${alert.reviewed_by_email}` : ""}
          </span>
        )}
        {alert.review_note && <span>« {alert.review_note} »</span>}
      </div>
      {error && (
        <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>
      )}
      {open && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => review("confirmed")}
            className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            {verdictPending === "confirmed" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            Confirmer la fraude
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => review("dismissed")}
            className="border-border inline-flex items-center gap-1.5 rounded-xl border bg-white px-3 py-1.5 text-xs font-bold transition hover:bg-slate-50 disabled:opacity-60"
          >
            {verdictPending === "dismissed" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <XCircle className="size-3.5" />
            )}
            Faux positif
          </button>
          {alert.status === "open" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => review("investigating")}
              className="text-muted rounded-xl px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-60"
            >
              {verdictPending === "investigating" ? "…" : "Marquer « enquête »"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function FraudAlertsView({ initial }: { initial: FraudAlertRow[] }) {
  const [status, setStatus] = useState<StatusFilter>("open_all");
  const [severity, setSeverity] = useState<FraudSeverity | null>(null);
  const [kind, setKind] = useState<FraudActorKind | null>(null);

  const rows = useMemo(
    () =>
      initial.filter(
        (a) =>
          (status === "open_all"
            ? a.status === "open" || a.status === "investigating"
            : a.status === status) &&
          (!severity || a.severity === severity) &&
          (!kind || a.actor_kind === kind)
      ),
    [initial, status, severity, kind]
  );

  return (
    <div className="mx-auto max-w-5xl space-y-3 px-4 py-5 lg:px-6">
      <div className="scrollbar-hide -mx-1 flex items-center gap-1.5 overflow-x-auto px-1">
        <Chip
          active={status === "open_all"}
          onClick={() => setStatus("open_all")}
        >
          À traiter
        </Chip>
        <Chip
          active={status === "confirmed"}
          onClick={() => setStatus("confirmed")}
        >
          Confirmées
        </Chip>
        <Chip
          active={status === "dismissed"}
          onClick={() => setStatus("dismissed")}
        >
          Faux positifs
        </Chip>
        <span className="bg-border mx-1 h-5 w-px shrink-0" />
        {FRAUD_SEVERITIES.map((s) => (
          <Chip
            key={s}
            active={severity === s}
            onClick={() => setSeverity(severity === s ? null : s)}
          >
            {FRAUD_SEVERITY_META[s].label}
          </Chip>
        ))}
        <span className="bg-border mx-1 h-5 w-px shrink-0" />
        {FRAUD_KINDS.map((k) => (
          <Chip
            key={k}
            active={kind === k}
            onClick={() => setKind(kind === k ? null : k)}
          >
            {FRAUD_KIND_LABEL[k]}
          </Chip>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="border-border rounded-2xl border bg-white p-8 text-center">
          <p className="text-muted text-sm">
            Aucune alerte{" "}
            {status === "open_all" ? "à traiter" : "dans ce filtre"}. ✨
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((a) => (
            <AlertCard key={a.id} alert={a} />
          ))}
        </ul>
      )}
    </div>
  );
}
