import Link from "next/link";
import { ChevronRight, Store, UserRound } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { AgentStatusBadge } from "@/components/admin/agents/agent-status-badge";
import { ModulePaymentAccount } from "@/components/admin/module-payment-account";

// =============================================================================
// Annuaire des Agents Coligo Pay (demandes à traiter + agents) — partagé entre
// la route transverse /admin/agents et l'onglet Agents du hub Coligo Pay &
// Finances (/admin/coligo-pay/agents). Les cartes pointent vers la fiche
// /admin/agents/[id] (inchangée). Lecture seule ; gate par le layout /admin.
// =============================================================================

type AgentRow = {
  id: string;
  display_name: string | null;
  owner_name: string | null;
  phone: string | null;
  status: string;
  is_verified: boolean | null;
  wilaya: string | null;
  commune: string | null;
  submitted_at: string | null;
  created_at: string;
};

async function loadAgents(): Promise<AgentRow[]> {
  const admin = createAdminClient();
  const { data } = await (
    admin.from as unknown as (t: string) => {
      select: (c: string) => {
        eq: (
          c: string,
          v: string
        ) => {
          order: (
            c: string,
            o: { ascending: boolean }
          ) => Promise<{ data: AgentRow[] | null }>;
        };
      };
    }
  )("operator_wallets")
    .select(
      "id, display_name, owner_name, phone, status, is_verified, wilaya, commune, submitted_at, created_at"
    )
    .eq("owner_type", "partner")
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function AgentsListView() {
  const all = await loadAgents();
  // Les demandes (auto-inscriptions à traiter) d'abord.
  const requests = all.filter(
    (a) => a.status === "pending" || a.status === "rejected"
  );
  const others = all.filter((a) => !["pending", "rejected"].includes(a.status));

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <header>
        <h1 className="text-foreground text-xl font-bold">Agents Coligo Pay</h1>
        <p className="text-muted mt-0.5 text-sm">
          Demandes de partenariat des points de recharge : examinez le dossier,
          validez les pièces, approuvez et attribuez le badge vérifié.
        </p>
      </header>

      <section>
        <h2 className="text-muted mb-2 text-xs font-bold tracking-wide uppercase">
          Demandes à traiter ({requests.length})
        </h2>
        {requests.length === 0 ? (
          <p className="border-border text-muted rounded-[14px] border border-dashed p-4 text-sm">
            Aucune demande en attente.
          </p>
        ) : (
          <ul className="space-y-2">
            {requests.map((a) => (
              <AgentCard key={a.id} a={a} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-muted mb-2 text-xs font-bold tracking-wide uppercase">
          Agents ({others.length})
        </h2>
        {others.length === 0 ? (
          <p className="border-border text-muted rounded-[14px] border border-dashed p-4 text-sm">
            Aucun agent actif pour le moment.
          </p>
        ) : (
          <ul className="space-y-2">
            {others.map((a) => (
              <AgentCard key={a.id} a={a} />
            ))}
          </ul>
        )}
      </section>

      <ModulePaymentAccount scope="partner" />
    </div>
  );
}

function AgentCard({ a }: { a: AgentRow }) {
  const loc = [a.commune, a.wilaya].filter(Boolean).join(", ");
  return (
    <li>
      <Link
        href={`/admin/agents/${a.id}`}
        className="border-border bg-surface hover:bg-surface-2 flex items-center gap-3 rounded-[14px] border p-3 shadow-sm"
      >
        <span className="bg-primary-50 text-primary-600 flex size-10 shrink-0 items-center justify-center rounded-full">
          <Store className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-sm font-semibold">
            {a.display_name ?? "Point sans nom"}
          </p>
          <p className="text-muted flex items-center gap-1.5 truncate text-xs">
            <UserRound className="size-3" />
            {a.owner_name ?? "—"}
            {a.phone ? ` · ${a.phone}` : ""}
            {loc ? ` · ${loc}` : ""}
          </p>
          <div className="mt-1">
            <AgentStatusBadge status={a.status} isVerified={a.is_verified} />
          </div>
        </div>
        <ChevronRight className="text-muted size-4 shrink-0" />
      </Link>
    </li>
  );
}
