import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// =============================================================================
// /admin/integrity — état des invariants financiers & d'état, EN DIRECT.
// -----------------------------------------------------------------------------
// Exécute `integrity_violations()` (mig 0298 — source unique, partagée avec le
// CLI `npm run audit:integrity` et le cron /api/cron/integrity) à chaque
// affichage → l'admin voit l'état RÉEL, pas une donnée mise en cache. Lecture
// service_role (la fonction est REVOKE authenticated) → self-guard obligatoire.
// C'est la cible de l'alerte super-admin « anomalie d'intégrité » (mig 0299).
// =============================================================================

type Violation = {
  code: string;
  severity: string;
  cnt: number;
  detail: string;
};
type LogRow = { note: string | null; created_at: string };

const SEV = {
  critical: {
    badge: "bg-danger-500 text-white",
    ring: "border-danger-200 bg-danger-50",
    label: "Critique",
  },
  warning: {
    badge: "bg-warning-500 text-white",
    ring: "border-warning-200 bg-warning-50",
    label: "À surveiller",
  },
  info: {
    badge: "bg-primary-500 text-white",
    ring: "border-primary-200 bg-primary-50",
    label: "Info",
  },
} as const;
const sev = (s: string) => SEV[s as keyof typeof SEV] ?? SEV.info;

export default async function AdminIntegrityPage() {
  await requireSuperAdmin();
  const admin = createAdminClient();

  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data: vData, error } = await rpc("integrity_violations");
  const violations = ((vData as Violation[] | null) ?? []).sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1
  );

  // Historique des détections du cron quotidien (10 dernières).
  const { data: logData } = await (
    admin.from as unknown as (t: string) => {
      select: (c: string) => {
        eq: (
          c: string,
          v: string
        ) => {
          order: (
            c: string,
            o: { ascending: boolean }
          ) => { limit: (n: number) => Promise<{ data: LogRow[] | null }> };
        };
      };
    }
  )("admin_audit_log")
    .select("note, created_at")
    .eq("action", "integrity_violation")
    .order("created_at", { ascending: false })
    .limit(10);
  const history = logData ?? [];

  const healthy = !error && violations.length === 0;

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-6">
      <header className="mb-4 flex items-center gap-2">
        <Activity className="size-6" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Intégrité de la plateforme
          </h1>
          <p className="text-muted text-sm">
            Invariants financiers et d&apos;état vérifiés en direct. Aussi
            lancés chaque jour (cron) et via{" "}
            <code className="text-xs">npm run audit:integrity</code>.
          </p>
        </div>
      </header>

      {/* Bandeau d'état global */}
      {error ? (
        <div className="border-danger-200 bg-danger-50 text-danger-800 flex items-center gap-3 rounded-[14px] border px-4 py-3.5">
          <ShieldAlert className="size-6 shrink-0" />
          <div>
            <p className="font-bold">Vérification indisponible</p>
            <p className="text-sm">{error.message}</p>
          </div>
        </div>
      ) : healthy ? (
        <div className="border-success-200 bg-success-50 text-success-800 flex items-center gap-3 rounded-[14px] border px-4 py-4">
          <CheckCircle2 className="size-7 shrink-0" />
          <div>
            <p className="font-bold">Tout est cohérent</p>
            <p className="text-sm">
              Aucun invariant violé — paiements, soldes et grands livres sains.
            </p>
          </div>
        </div>
      ) : (
        <div className="border-danger-200 bg-danger-50 text-danger-800 flex items-center gap-3 rounded-[14px] border px-4 py-4">
          <AlertTriangle className="size-7 shrink-0 animate-pulse" />
          <div>
            <p className="font-bold">
              {violations.length} invariant
              {violations.length > 1 ? "s" : ""} violé
              {violations.length > 1 ? "s" : ""} — action requise
            </p>
            <p className="text-sm">
              Chaque ligne ci-dessous est une anomalie réelle à corriger.
            </p>
          </div>
        </div>
      )}

      {/* Liste des violations */}
      {violations.length > 0 && (
        <ul
          data-alert-focus="integrity_violation"
          className="mt-4 space-y-2.5 rounded-[12px]"
        >
          {violations.map((v) => {
            const s = sev(v.severity);
            return (
              <li
                key={v.code}
                className={`rounded-[12px] border px-4 py-3 ${s.ring}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground font-mono text-[13px] font-bold">
                    {v.code}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-foreground rounded-full bg-white/70 px-2 py-0.5 text-xs font-bold tabular-nums">
                      ×{v.cnt}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${s.badge}`}
                    >
                      {s.label}
                    </span>
                  </span>
                </div>
                <p className="text-muted mt-1 text-sm">{v.detail}</p>
              </li>
            );
          })}
        </ul>
      )}

      {/* Historique des détections (cron) */}
      <section className="mt-8">
        <h2 className="text-muted mb-2 text-xs font-extrabold tracking-wide uppercase">
          Détections récentes (surveillance quotidienne)
        </h2>
        {history.length === 0 ? (
          <p className="text-subtle text-sm">
            Aucune anomalie détectée par le cron sur la période conservée.
          </p>
        ) : (
          <ul className="divide-border border-border divide-y overflow-hidden rounded-[12px] border bg-white">
            {history.map((h, i) => (
              <li
                key={i}
                className="flex items-start gap-3 px-4 py-2.5 text-sm"
              >
                <AlertTriangle className="text-warning-600 mt-0.5 size-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-foreground truncate font-medium">
                    {h.note ?? "—"}
                  </p>
                  <p className="text-subtle text-xs">
                    {new Date(h.created_at).toLocaleString("fr-FR", {
                      timeZone: "Africa/Algiers",
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
