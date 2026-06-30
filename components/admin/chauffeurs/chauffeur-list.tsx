"use client";

import { ChauffeurActions } from "@/components/admin/chauffeur-actions";
import {
  Pager,
  SearchInput,
  usePaginatedList,
} from "@/components/admin/shared/list-controls";
import { useAdminList } from "@/lib/admin/use-admin-list";

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

function vehicleOf(c: ChauffeurRow) {
  return [c.vehicle_make, c.vehicle_model].filter(Boolean).join(" ") || "—";
}

export function ChauffeurList({
  initialRows,
}: {
  initialRows: ChauffeurRow[];
}) {
  // Cache TanStack Query (réaffichage instantané au retour de nav + refetch
  // silencieux), hydraté par le rendu serveur.
  const rows = useAdminList<ChauffeurRow>(
    "admin-chauffeurs",
    "/api/admin/chauffeurs",
    initialRows
  );
  const {
    query,
    setQuery,
    page,
    setPage,
    pageItems,
    filteredCount,
    pageCount,
  } = usePaginatedList<ChauffeurRow>({
    items: rows,
    search: (c, q) =>
      [c.full_name, c.phone, c.vehicle_plate, c.gamme]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    pageSize: 20,
  });

  return (
    <div className="space-y-4">
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Rechercher : nom, téléphone, plaque, gamme…"
      />
      <p className="text-muted text-xs tabular-nums">
        {filteredCount} chauffeur{filteredCount > 1 ? "s" : ""}
        {query ? ` sur ${rows.length}` : ""}
      </p>

      {pageItems.length === 0 ? (
        <div className="bg-surface border-border text-muted rounded-[14px] border p-8 text-center text-sm">
          {query
            ? `Aucun chauffeur ne correspond à « ${query} ».`
            : "Aucun chauffeur inscrit pour l'instant."}
        </div>
      ) : (
        <div className="bg-surface border-border overflow-x-auto rounded-[14px] border">
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
              {pageItems.map((c) => (
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

      <Pager page={page} pageCount={pageCount} onPage={setPage} />
    </div>
  );
}
