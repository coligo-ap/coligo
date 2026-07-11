"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bike, Loader2, ShieldAlert, User } from "lucide-react";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { resolveDeliveryReport } from "@/app/admin/actions";

type ReportRow = {
  id: string;
  order_id: string;
  order_number: string | null;
  reporter_role: "customer" | "driver";
  reason: string;
  details: string | null;
  status: "open" | "reviewing" | "resolved" | "dismissed";
  customer_name: string | null;
  driver_name: string | null;
  created_at: string;
  resolved_at: string | null;
  admin_note: string | null;
};

const STATUS_META: Record<ReportRow["status"], { label: string; cls: string }> =
  {
    open: { label: "À traiter", cls: "bg-danger-100 text-danger-700" },
    reviewing: { label: "En cours", cls: "bg-warning-100 text-warning-800" },
    resolved: { label: "Résolu", cls: "bg-success-100 text-success-700" },
    dismissed: { label: "Rejeté", cls: "bg-surface-3 text-muted" },
  };

const FILTERS = [
  { key: "all", label: "Tous" },
  { key: "open", label: "À traiter" },
  { key: "reviewing", label: "En cours" },
  { key: "resolved", label: "Résolus" },
  { key: "dismissed", label: "Rejetés" },
] as const;

export function AdminReportsList({ rows }: { rows: ReportRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();
  const [note, setNote] = useActionNote();

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter]
  );

  const act = (id: string, status: ReportRow["status"]) => {
    setPendingId(id);
    start(async () => {
      const r = await resolveDeliveryReport({ reportId: id, status });
      setPendingId(null);
      // Succès : le statut du signalement change dans la liste via refresh.
      if (r.error) setNote({ ok: false, text: r.error });
      else router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <ActionNote note={note} />
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
              (filter === f.key
                ? "bg-primary-600 text-white"
                : "border-border text-muted hover:bg-surface-2 border")
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted py-12 text-center text-sm">
          Aucun signalement.
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((r) => {
            const meta = STATUS_META[r.status];
            const busy = pendingId === r.id;
            // reporter_role='customer' → le client signale le LIVREUR (cible).
            const targetIcon = r.reporter_role === "customer" ? Bike : User;
            const TargetIcon = targetIcon;
            const targetName =
              r.reporter_role === "customer"
                ? (r.driver_name ?? "Livreur")
                : (r.customer_name ?? "Client");
            const reporterLabel =
              r.reporter_role === "customer" ? "Client" : "Livreur";
            return (
              <li
                key={r.id}
                className="border-border bg-surface rounded-[14px] border p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-bold">
                      <ShieldAlert className="text-danger-600 size-4 shrink-0" />
                      {r.reason}
                    </p>
                    <p className="text-muted mt-1 text-xs">
                      {reporterLabel} signale{" "}
                      <span className="text-foreground inline-flex items-center gap-1 font-semibold">
                        <TargetIcon className="size-3" />
                        {targetName}
                      </span>{" "}
                      · #{r.order_number ?? r.order_id.slice(0, 6)}
                    </p>
                  </div>
                  <span
                    className={
                      "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold " +
                      meta.cls
                    }
                  >
                    {meta.label}
                  </span>
                </div>

                {r.details && (
                  <p className="text-foreground/80 bg-surface-2 mt-2.5 rounded-[10px] p-2.5 text-[13px]">
                    {r.details}
                  </p>
                )}

                <p className="text-subtle mt-2 text-[11px]">
                  {new Date(r.created_at).toLocaleString("fr-DZ", {
                    timeZone: "Africa/Algiers",
                  })}
                </p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(["reviewing", "resolved", "dismissed"] as const).map(
                    (s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={busy || r.status === s}
                        onClick={() => act(r.id, s)}
                        className="border-border hover:bg-surface-2 inline-flex items-center gap-1 rounded-[10px] border px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                      >
                        {busy && <Loader2 className="size-3 animate-spin" />}
                        {STATUS_META[s].label}
                      </button>
                    )
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
