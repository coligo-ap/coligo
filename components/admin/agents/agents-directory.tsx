"use client";

import { useMemo } from "react";
import { AgentCard } from "@/components/admin/agents/agent-card";
import {
  Pager,
  SearchInput,
  usePaginatedList,
} from "@/components/admin/shared/list-controls";
import { useAdminList } from "@/lib/admin/use-admin-list";
import type { AgentRow } from "@/lib/data/admin-agents";

// Annuaire des agents ACTIFS (hors demandes en attente / refusées, qui vivent
// dans l'onglet Inscriptions) — recherche + pagination.
export function AgentsDirectory({
  initialAgents,
}: {
  initialAgents: AgentRow[];
}) {
  // Cache TanStack Query (réaffichage instantané au retour + refetch silencieux).
  const agents = useAdminList<AgentRow>(
    "admin-agents",
    "/api/admin/agents",
    initialAgents
  );
  const active = useMemo(
    () => agents.filter((a) => !["pending", "rejected"].includes(a.status)),
    [agents]
  );
  const {
    query,
    setQuery,
    page,
    setPage,
    pageItems,
    filteredCount,
    pageCount,
  } = usePaginatedList<AgentRow>({
    items: active,
    search: (a, q) =>
      [a.display_name, a.owner_name, a.phone, a.wilaya, a.commune]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    pageSize: 20,
  });

  return (
    <div className="space-y-4">
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Rechercher un agent : nom, propriétaire, téléphone, wilaya…"
      />
      <p className="text-muted text-xs tabular-nums">
        {filteredCount} agent{filteredCount > 1 ? "s" : ""}
        {query ? ` sur ${active.length}` : ""}
      </p>

      {pageItems.length === 0 ? (
        <p className="border-border text-muted rounded-[14px] border border-dashed p-6 text-center text-sm">
          {query
            ? `Aucun agent ne correspond à « ${query} ».`
            : "Aucun agent actif pour le moment."}
        </p>
      ) : (
        <ul className="space-y-2">
          {pageItems.map((a) => (
            <AgentCard key={a.id} a={a} />
          ))}
        </ul>
      )}

      <Pager page={page} pageCount={pageCount} onPage={setPage} />
    </div>
  );
}
