"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { ChauffeurActions } from "@/components/admin/chauffeur-actions";
import { SearchInput } from "@/components/admin/shared/list-controls";

export type ChauffeurRow = {
  id: string;
  full_name: string;
  phone: string | null;
  gamme: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_plate: string | null;
  is_verified: boolean | null;
  is_frozen: boolean | null;
  is_blocked: boolean | null;
  frozen_reason: string | null;
};

// « Voir plus » ajoute une poignée de lignes à la demande — on ne charge
// jamais tout l'annuaire (la page n'en rend que 3 au départ, la recherche
// EN BASE fait le travail, comme l'annuaire commerçants).
const PAGE = 20;

function vehicleOf(c: ChauffeurRow) {
  return [c.vehicle_make, c.vehicle_model].filter(Boolean).join(" ") || "—";
}

export function ChauffeurList({
  initialRows,
  initialTotal,
}: {
  initialRows: ChauffeurRow[];
  initialTotal: number;
}) {
  const [rows, setRows] = useState<ChauffeurRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (q: string, offset: number) => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/chauffeurs?q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${offset}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        rows: ChauffeurRow[];
        total: number;
      };
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

  // Après une action (vérifier/geler/bloquer → router.refresh), le serveur
  // renvoie des props fraîches : hors recherche, on résynchronise l'échantillon
  // affiché pour que les statuts reflètent l'état réel.
  useEffect(() => {
    if (!query) {
      setRows(initialRows);
      setTotal(initialTotal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRows, initialTotal]);

  return (
    <div className="space-y-4">
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Rechercher : nom, téléphone, plaque, gamme…"
      />
      <p className="text-muted flex items-center gap-2 text-xs tabular-nums">
        {rows.length} affiché{rows.length > 1 ? "s" : ""} sur {total} chauffeur
        {total > 1 ? "s" : ""}
        {query ? " (recherche)" : ""}
        {busy && <Loader2 className="size-3.5 animate-spin" />}
      </p>

      {rows.length === 0 ? (
        <div className="bg-surface border-border text-muted rounded-card-lg border p-8 text-center text-sm">
          {query
            ? `Aucun chauffeur ne correspond à « ${query} ».`
            : "Aucun chauffeur inscrit pour l'instant."}
        </div>
      ) : (
        <div className="bg-surface border-border rounded-card-lg overflow-x-auto border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Nom</th>
                <th className="px-3 py-2 text-left">Téléphone</th>
                <th className="px-3 py-2 text-left">Gamme</th>
                <th className="px-3 py-2 text-left">Véhicule</th>
                <th className="px-3 py-2 text-left">Statut</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-border border-t">
                  <td className="px-3 py-2 font-medium">
                    <a
                      href={`/admin/chauffeurs/${c.id}`}
                      className="text-primary-700 hover:underline"
                    >
                      {c.full_name}
                    </a>
                  </td>
                  <td className="text-muted px-3 py-2 tabular-nums">
                    {c.phone}
                  </td>
                  <td className="px-3 py-2 capitalize">{c.gamme}</td>
                  <td className="text-muted px-3 py-2">
                    {vehicleOf(c)}
                    {c.vehicle_plate ? ` · ${c.vehicle_plate}` : ""}
                  </td>
                  <td className="px-3 py-2">
                    {c.is_blocked ? (
                      <span className="text-danger-700 text-xs font-bold">
                        Bloqué
                      </span>
                    ) : c.is_frozen ? (
                      <span className="text-warning-800 text-xs font-bold">
                        Gelé{c.frozen_reason ? ` · ${c.frozen_reason}` : ""}
                      </span>
                    ) : c.is_verified ? (
                      <span className="text-success-700 text-xs font-bold">
                        Actif
                      </span>
                    ) : (
                      <span className="text-muted text-xs">Non vérifié</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <ChauffeurActions
                      chauffeurId={c.id}
                      isVerified={!!c.is_verified}
                      isFrozen={!!c.is_frozen}
                      isBlocked={!!c.is_blocked}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
