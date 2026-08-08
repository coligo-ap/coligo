import { BellRing, MapPin, ShieldX } from "lucide-react";
import { SERVICE_LABELS, type ServiceKind } from "@/lib/zones/service-zones";
import { getWilayaName } from "@/lib/config/wilayas";
import type { ZoneStatRow } from "./types";

const SERVICES: ServiceKind[] = ["express", "tour", "drive"];

function zoneLabel(r: ZoneStatRow): string {
  if (r.commune) return `${r.commune} (${getWilayaName(r.wilaya_code ?? "")})`;
  if (r.wilaya_code) return getWilayaName(r.wilaya_code);
  return "Point GPS (hors wilaya identifiée)";
}

function totals(rows: ZoneStatRow[]): Record<ServiceKind, number> {
  const t: Record<ServiceKind, number> = { express: 0, tour: 0, drive: 0 };
  for (const r of rows) t[r.service] = (t[r.service] ?? 0) + Number(r.cnt);
  return t;
}

function StatCard({
  title,
  icon,
  rows,
  emptyText,
  accent,
}: {
  title: string;
  icon: React.ReactNode;
  rows: ZoneStatRow[];
  emptyText: string;
  accent: string;
}) {
  const t = totals(rows);
  const top = [...rows]
    .sort((a, b) => Number(b.cnt) - Number(a.cnt))
    .slice(0, 8);
  return (
    <div className="bg-surface border-border rounded-card-lg border p-4">
      <h3 className="text-foreground mb-3 flex items-center gap-2 text-sm font-bold">
        {icon}
        {title}
      </h3>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {SERVICES.map((s) => (
          <div
            key={s}
            className="bg-surface-2 rounded-control p-2.5 text-center"
          >
            <div className={"text-lg font-extrabold " + accent}>{t[s]}</div>
            <div className="text-muted text-caption font-semibold">
              {SERVICE_LABELS[s]}
            </div>
          </div>
        ))}
      </div>
      {top.length === 0 ? (
        <p className="text-muted text-xs">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {top.map((r, i) => (
            <li
              key={i}
              className="text-foreground text-body-sm flex items-center justify-between gap-2"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <MapPin className="text-subtle size-3.5 shrink-0" />
                <span className="truncate">{zoneLabel(r)}</span>
                <span className="text-subtle text-caption shrink-0">
                  · {SERVICE_LABELS[r.service]}
                </span>
              </span>
              <span className="text-foreground shrink-0 font-bold tabular-nums">
                {Number(r.cnt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Statistiques opérationnelles du moteur de zones (mig 0170) : où la demande
 * est-elle refusée (hors zone) et où les clients attendent l'ouverture.
 */
export function ZoneStats({
  blocks,
  waitlist,
}: {
  blocks: ZoneStatRow[];
  waitlist: ZoneStatRow[];
}) {
  return (
    <div className="mt-8">
      <h2 className="text-foreground mb-3 text-sm font-bold">
        Statistiques opérationnelles
      </h2>
      <div className="grid gap-3 lg:grid-cols-2">
        <StatCard
          title="Demande refusée hors zone (30 j)"
          icon={<ShieldX className="text-danger-600 size-4" />}
          rows={blocks}
          emptyText="Aucun refus enregistré — toutes les demandes passent."
          accent="text-danger-700"
        />
        <StatCard
          title="Liste d'attente « Prévenez-moi » (90 j)"
          icon={<BellRing className="text-primary-600 size-4" />}
          rows={waitlist}
          emptyText="Aucune inscription en liste d'attente."
          accent="text-primary-700"
        />
      </div>
      <p className="text-subtle text-caption mt-2">
        Priorisez l&apos;ouverture des zones où la demande refusée et la liste
        d&apos;attente sont les plus fortes.
      </p>
    </div>
  );
}
