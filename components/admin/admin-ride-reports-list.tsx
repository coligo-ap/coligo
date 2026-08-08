"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Car, Loader2, MapPin, Phone, ShieldAlert, User } from "lucide-react";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { cn } from "@/lib/utils";
import { resolveRideReport } from "@/app/admin/actions";

export type RideReportRow = {
  id: string;
  ride_id: string;
  reporter: "customer" | "chauffeur";
  reason: string;
  status: "open" | "reviewed" | "dismissed";
  decision: string | null;
  created_at: string;
  reviewed_at: string | null;
  chauffeur_name: string | null;
  chauffeur_phone: string | null;
  pickup_text: string | null;
  dest_text: string | null;
  ride_status: string | null;
  price_da: number | null;
};

const STATUS_META: Record<
  RideReportRow["status"],
  { label: string; cls: string }
> = {
  open: { label: "À traiter", cls: "bg-danger-100 text-danger-700" },
  reviewed: { label: "Traité", cls: "bg-success-100 text-success-700" },
  dismissed: { label: "Rejeté", cls: "bg-surface-3 text-muted" },
};

const FILTERS = [
  { key: "all", label: "Tous" },
  { key: "open", label: "À traiter" },
  { key: "reviewed", label: "Traités" },
  { key: "dismissed", label: "Rejetés" },
] as const;

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Africa/Algiers",
  });

export function AdminRideReportsList({ rows }: { rows: RideReportRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();
  const [note, setNote] = useActionNote();

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter]
  );
  const openCount = useMemo(
    () => rows.filter((r) => r.status === "open").length,
    [rows]
  );

  const act = (id: string, status: RideReportRow["status"]) => {
    setPendingId(id);
    start(async () => {
      const r = await resolveRideReport({ reportId: id, status });
      setPendingId(null);
      // Succès : le statut du signalement change dans la liste via refresh.
      if (r.error) setNote({ ok: false, text: r.error });
      else router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <ActionNote note={note} />
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
              filter === f.key
                ? "border-primary-300 bg-primary-50 text-primary-700"
                : "border-border text-muted hover:bg-surface-2"
            )}
          >
            {f.label}
            {f.key === "open" && openCount > 0 && (
              <span className="text-danger-600 ml-1 tabular-nums">
                {openCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted text-sm">Aucun signalement de course.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const meta = STATUS_META[r.status];
            const busy = pendingId === r.id;
            return (
              <div
                key={r.id}
                className="border-border bg-surface rounded-card-lg border p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-bold",
                      meta.cls
                    )}
                  >
                    {meta.label}
                  </span>
                  <span className="text-muted inline-flex items-center gap-1 text-xs">
                    {r.reporter === "customer" ? (
                      <User className="size-3" />
                    ) : (
                      <Car className="size-3" />
                    )}
                    Signalé par{" "}
                    {r.reporter === "customer" ? "le client" : "le chauffeur"}
                  </span>
                  <span className="text-muted ml-auto text-xs">
                    {fmt(r.created_at)}
                  </span>
                </div>

                <p className="text-foreground mt-2 flex items-start gap-1.5 text-sm font-medium">
                  <ShieldAlert className="text-danger-500 mt-0.5 size-4 shrink-0" />
                  {r.reason}
                </p>

                <dl className="text-muted mt-2 grid gap-1 text-xs sm:grid-cols-2">
                  <div className="flex items-center gap-1.5">
                    <Car className="size-3" />
                    {r.chauffeur_name ?? "Chauffeur —"}
                    {r.chauffeur_phone && (
                      <a
                        href={`tel:${r.chauffeur_phone}`}
                        className="text-primary-700 inline-flex items-center gap-0.5 font-medium hover:underline"
                      >
                        <Phone className="size-3" />
                        {r.chauffeur_phone}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MapPin className="size-3" />
                    {[r.pickup_text, r.dest_text].filter(Boolean).join(" → ") ||
                      "Trajet —"}
                  </div>
                </dl>

                {r.status !== "open" && r.decision && (
                  <p className="text-muted mt-2 text-xs">
                    Décision : <span className="font-medium">{r.decision}</span>
                  </p>
                )}

                <div className="border-border mt-3 flex flex-wrap gap-1.5 border-t pt-3">
                  {r.status !== "reviewed" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(r.id, "reviewed")}
                      className="bg-success-600 hover:bg-success-700 rounded-control inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : null}
                      Marquer traité
                    </button>
                  )}
                  {r.status !== "dismissed" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(r.id, "dismissed")}
                      className="border-border hover:bg-surface-2 text-foreground rounded-control inline-flex items-center gap-1 border px-3 py-1.5 text-xs font-bold disabled:opacity-50"
                    >
                      Rejeter
                    </button>
                  )}
                  {r.status !== "open" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(r.id, "open")}
                      className="text-muted hover:text-foreground rounded-control inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    >
                      Rouvrir
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
