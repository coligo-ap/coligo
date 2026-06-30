"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { DriverFreezeButton } from "@/components/admin/driver-freeze-button";
import { DriverStatusBadge } from "@/components/admin/drivers/driver-status-badge";
import {
  Pager,
  SearchInput,
  usePaginatedList,
} from "@/components/admin/shared/list-controls";
import { useAdminList } from "@/lib/admin/use-admin-list";

export type DriverRow = {
  id: string;
  full_name: string;
  phone: string | null;
  is_frozen: boolean | null;
  is_blocked: boolean | null;
  is_verified: boolean | null;
  avatar_url: string | null;
  active: number;
  pending: number;
  blocked: number;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase();
}

export function DriverList({ initialRows }: { initialRows: DriverRow[] }) {
  // Cache TanStack Query (réaffichage instantané au retour de nav + refetch
  // silencieux), hydraté par le rendu serveur.
  const rows = useAdminList<DriverRow>(
    "admin-drivers",
    "/api/admin/drivers",
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
  } = usePaginatedList<DriverRow>({
    items: rows,
    search: (d, q) =>
      [d.full_name, d.phone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    pageSize: 20,
  });

  return (
    <div className="space-y-4">
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Rechercher un livreur : nom ou téléphone…"
      />
      <p className="text-muted text-xs tabular-nums">
        {filteredCount} livreur{filteredCount > 1 ? "s" : ""}
        {query ? ` sur ${rows.length}` : ""}
      </p>

      {pageItems.length === 0 ? (
        <div className="bg-surface border-border text-muted rounded-[14px] border p-8 text-center text-sm">
          {query
            ? `Aucun livreur ne correspond à « ${query} ».`
            : "Aucun livreur enregistré."}
        </div>
      ) : (
        <table className="bg-surface border-border w-full overflow-hidden rounded-[14px] border text-sm">
          <thead className="bg-surface-2 text-muted text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Nom</th>
              <th className="px-3 py-2 text-left">Téléphone</th>
              <th className="px-3 py-2 text-center">Statut</th>
              <th className="px-3 py-2 text-right">Actifs</th>
              <th className="px-3 py-2 text-right">En attente</th>
              <th className="px-3 py-2 text-right">Bloqués</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {pageItems.map((d) => (
              <tr
                key={d.id}
                className={
                  d.is_blocked
                    ? "bg-danger-50"
                    : d.is_frozen
                      ? "bg-warning-50/60"
                      : "hover:bg-surface-2"
                }
              >
                <td className="px-3 py-2 font-medium">
                  <Link
                    href={`/admin/drivers/${d.id}`}
                    className="hover:text-primary-700 inline-flex items-center gap-2"
                  >
                    {d.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={d.avatar_url}
                        alt=""
                        className="size-7 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="bg-primary-100 text-primary-700 grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-bold">
                        {initials(d.full_name)}
                      </span>
                    )}
                    {d.full_name}
                    <ChevronRight className="text-muted size-3.5" />
                  </Link>
                </td>
                <td className="text-muted px-3 py-2 tabular-nums">{d.phone}</td>
                <td className="px-3 py-2 text-center">
                  <DriverStatusBadge
                    isBlocked={d.is_blocked}
                    isFrozen={d.is_frozen}
                    isVerified={d.is_verified}
                  />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {d.active}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {d.pending}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {d.blocked}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/admin/drivers/${d.id}`}
                      className="border-border hover:bg-surface-2 rounded-[8px] border px-2.5 py-1 text-xs font-semibold"
                    >
                      Gérer
                    </Link>
                    <DriverFreezeButton
                      driverId={d.id}
                      frozen={d.is_frozen ?? false}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Pager page={page} pageCount={pageCount} onPage={setPage} />
    </div>
  );
}
