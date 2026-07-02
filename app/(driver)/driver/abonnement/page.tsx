import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverShell } from "@/components/driver/driver-shell";
import { PriorityCard } from "@/components/partner/priority-card";
import {
  PartnerBackHeader,
  PartnerBadge,
} from "@/components/shared/partner-ui";

export const dynamic = "force-dynamic";

/**
 * SOUS-PAGE « Abonnement & Pass » du compte livreur (parité
 * /chauffeur/abonnement) : gestion du Pass Prioritaire (souscription wallet /
 * carte, statut, renouvellement — via la PriorityCard partagée) + HISTORIQUE
 * des abonnements (lecture RLS owner_read sur priority_subscriptions).
 * Le compte n'affiche plus la grande carte : une simple ligne pointe ici.
 */

const STATUS_META: Record<
  string,
  { label: string; tone: "ok" | "violet" | "muted" | "ko" }
> = {
  active: { label: "Actif", tone: "ok" },
  pending: { label: "En attente", tone: "violet" },
  expired: { label: "Expiré", tone: "muted" },
  cancelled: { label: "Annulé", tone: "ko" },
};
const METHOD_LABEL: Record<string, string> = {
  wallet: "Coligo Pay",
  ccp: "CCP",
  card: "Carte",
};

function grp(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Algiers",
  });
}

export default async function DriverAbonnementPage() {
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  // Historique des abonnements Pass (RLS : le livreur ne voit que les siens ;
  // filtre explicite quand même — jamais compter sur la seule RLS).
  type SubRow = {
    id: string;
    status: string;
    period_start: string | null;
    period_end: string | null;
    amount_da: number;
    is_first_month: boolean;
    payment_method: string;
    created_at: string;
  };
  const supabase = await createClient();
  // Cast client non typé : `priority_subscriptions` (mig 0210) est absente des
  // types générés (la RLS owner_read reste la garde effective).
  const { data: subsRaw } = await (supabase as unknown as SupabaseClient)
    .from("priority_subscriptions")
    .select(
      "id, status, period_start, period_end, amount_da, is_first_month, payment_method, created_at"
    )
    .eq("subject_type", "driver")
    .eq("subject_id", driver.id)
    .order("created_at", { ascending: false })
    .limit(24);
  const subs = (subsRaw ?? []) as unknown as SubRow[];

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <PartnerBackHeader
        href="/driver/parametres"
        title="Abonnement & Pass"
        subtitle="Pass Prioritaire · gestion & historique"
      />

      {/* Gestion du Pass (souscrire / renouveler / statut) — carte partagée. */}
      <PriorityCard />

      {/* Historique des abonnements */}
      {subs.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 px-1 text-[11px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
            Historique
          </p>
          <div className="overflow-hidden rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)]">
            {subs.map((s) => {
              const meta = STATUS_META[s.status] ?? {
                label: s.status,
                tone: "muted" as const,
              };
              const period =
                s.period_start && s.period_end
                  ? `${fmtDate(s.period_start)} → ${fmtDate(s.period_end)}`
                  : (fmtDate(s.created_at) ?? "");
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-3 border-b border-[var(--d-line)] px-3.5 py-3 last:border-b-0"
                >
                  <span className="min-w-0 flex-1">
                    <b className="block text-[13.5px] font-semibold text-[var(--d-ink)] tabular-nums">
                      {grp(s.amount_da)} DA
                      {s.is_first_month ? " · 1er mois" : ""}
                    </b>
                    <span className="block truncate text-[11.5px] text-[var(--d-muted)]">
                      {period} ·{" "}
                      {METHOD_LABEL[s.payment_method] ?? s.payment_method}
                    </span>
                  </span>
                  <PartnerBadge tone={meta.tone}>{meta.label}</PartnerBadge>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </DriverShell>
  );
}
