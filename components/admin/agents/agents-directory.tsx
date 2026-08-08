"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { AgentCard } from "@/components/admin/agents/agent-card";
import { SearchInput } from "@/components/admin/shared/list-controls";
import type { AgentRow } from "@/lib/data/admin-agents";

// « Voir plus » ajoute une poignée de lignes à la demande — on ne charge
// jamais tout l'annuaire (la page n'en rend que 3 au départ, la recherche
// EN BASE fait le travail, comme les annuaires commerçants/livreurs/clients).
const PAGE = 20;

// Annuaire des agents ACTIFS (hors demandes en attente / refusées, qui vivent
// dans l'onglet Inscriptions) — le filtre de statut est fait EN BASE.
export function AgentsDirectory({
  initialAgents,
  initialTotal,
}: {
  initialAgents: AgentRow[];
  initialTotal: number;
}) {
  const [rows, setRows] = useState<AgentRow[]>(initialAgents);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (q: string, offset: number) => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/agents?q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${offset}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as { rows: AgentRow[]; total: number };
      setTotal(data.total);
      setRows((prev) => (offset === 0 ? data.rows : [...prev, ...data.rows]));
    } finally {
      setBusy(false);
    }
  }, []);

  // Recherche EN BASE, temporisée : on ne part pas à chaque frappe.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => void load(query, 0), 350);
    return () => clearTimeout(id);
  }, [query, load]);

  // Après une action (statut/badge → router.refresh), le serveur renvoie des
  // props fraîches : hors recherche, on résynchronise l'échantillon affiché.
  useEffect(() => {
    if (!query) {
      setRows(initialAgents);
      setTotal(initialTotal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAgents, initialTotal]);

  return (
    <div className="space-y-4">
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Rechercher un agent : nom, propriétaire, téléphone, wilaya…"
      />
      <p className="text-muted flex items-center gap-2 text-xs tabular-nums">
        {rows.length} affiché{rows.length > 1 ? "s" : ""} sur {total} agent
        {total > 1 ? "s" : ""}
        {query ? " (recherche)" : ""}
        {busy && <Loader2 className="size-3.5 animate-spin" />}
      </p>

      {rows.length === 0 ? (
        <p className="border-border text-muted rounded-card-lg border border-dashed p-6 text-center text-sm">
          {query
            ? `Aucun agent ne correspond à « ${query} ».`
            : "Aucun agent actif pour le moment."}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => (
            <AgentCard key={a.id} a={a} />
          ))}
        </ul>
      )}

      {rows.length < total && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void load(query, rows.length)}
          className="border-border text-foreground hover:bg-surface-2 w-full rounded-md border px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60"
        >
          {busy
            ? "Chargement…"
            : `Voir plus (${total - rows.length} restant${total - rows.length > 1 ? "s" : ""})`}
        </button>
      )}
    </div>
  );
}
