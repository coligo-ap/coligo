"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2 } from "lucide-react";
import { DriverFreezeButton } from "@/components/admin/driver-freeze-button";
import { DriverStatusBadge } from "@/components/admin/drivers/driver-status-badge";
import { SearchInput } from "@/components/admin/shared/list-controls";

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

// « Voir plus » ajoute une poignée de lignes à la demande — on ne charge
// jamais tout l'annuaire (la page n'en rend que 3 au départ, la recherche
// EN BASE fait le travail, comme l'annuaire commerçants).
const PAGE = 20;

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase();
}

export function DriverList({
  initialRows,
  initialTotal,
}: {
  initialRows: DriverRow[];
  initialTotal: number;
}) {
  const [rows, setRows] = useState<DriverRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (q: string, offset: number) => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/drivers?q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${offset}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as { rows: DriverRow[]; total: number };
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

  // Après une action (gel/dégel → router.refresh), le serveur renvoie des
  // props fraîches : hors recherche, on résynchronise l'échantillon affiché
  // pour que les badges reflètent l'état réel.
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
        placeholder="Rechercher un livreur : nom ou téléphone…"
      />
      <p className="text-muted flex items-center gap-2 text-xs tabular-nums">
        {rows.length} affiché{rows.length > 1 ? "s" : ""} sur {total} livreur
        {total > 1 ? "s" : ""}
        {query ? " (recherche)" : ""}
        {busy && <Loader2 className="size-3.5 animate-spin" />}
      </p>

      {rows.length === 0 ? (
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
            {rows.map((d) => (
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

      {rows.length < total && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void load(query, rows.length)}
          className="border-border text-foreground hover:bg-surface-2 w-full rounded-[12px] border px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60"
        >
          {busy
            ? "Chargement…"
            : `Voir plus (${total - rows.length} restant${total - rows.length > 1 ? "s" : ""})`}
        </button>
      )}
    </div>
  );
}
