"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import {
  recomputeDriveLearning,
  type LearningRow,
} from "@/app/admin/drive/actions";

const BANDS = [
  { i: 0, label: "Nuit", sub: "0-6 h" },
  { i: 1, label: "Matin", sub: "7-9 h" },
  { i: 2, label: "Journée", sub: "10-15 h" },
  { i: 3, label: "Soir", sub: "16-19 h" },
  { i: 4, label: "Soirée", sub: "20-23 h" },
];

function cellColor(coef: number): string {
  // 1,0 = neutre ; >1 = monte (orange/rouge) ; <1 = baisse (bleu).
  if (coef >= 1.15) return "#FDE2E2";
  if (coef >= 1.05) return "#FFF0E0";
  if (coef <= 0.92) return "#E3F1FF";
  return "#F1F5F9";
}

export function DriveLearningMonitor({ initial }: { initial: LearningRow[] }) {
  const [rows, setRows] = useState<LearningRow[]>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const zones = [...new Set(rows.map((r) => r.zone))].sort((a, b) =>
    a === "national" ? 1 : b === "national" ? -1 : a.localeCompare(b)
  );
  const get = (zone: string, band: number) =>
    rows.find((r) => r.zone === zone && r.band === band);

  const recompute = () =>
    start(async () => {
      setMsg(null);
      const res = await recomputeDriveLearning();
      setMsg(
        res.ok
          ? `Recalculé · ${res.bands} créneaux mis à jour`
          : (res.error ?? "Erreur")
      );
      // Recharge la page (revalidatePath côté serveur) après un court délai.
      if (res.ok) setTimeout(() => window.location.reload(), 700);
    });

  return (
    <div className="border-border rounded-card-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Auto-calibrage du prix</h2>
          <p className="text-muted-foreground text-xs">
            Coef appris par ville × créneau (1,00 = barème ; &gt;1 = le marché
            veut plus cher ; &lt;1 = marge pour le client). Bornes 0,85–1,30.
          </p>
        </div>
        <button
          type="button"
          onClick={recompute}
          disabled={pending}
          className="rounded-control flex items-center gap-2 border px-3 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Recalculer
        </button>
      </div>
      {msg && <p className="mb-2 text-xs font-semibold">{msg}</p>}

      {rows.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          Aucune donnée encore — le coef vaut 1,00 partout (barème initial). Il
          s’alimente dès que des courses sont créées.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-center text-sm">
            <thead>
              <tr>
                <th className="p-2 text-left text-xs font-semibold">Ville</th>
                {BANDS.map((b) => (
                  <th key={b.i} className="p-2 text-xs font-semibold">
                    {b.label}
                    <span className="text-muted-foreground text-micro block font-normal">
                      {b.sub}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {zones.map((zone) => (
                <tr key={zone} className="border-border border-t">
                  <td className="p-2 text-left text-xs font-bold capitalize">
                    {zone}
                  </td>
                  {BANDS.map((b) => {
                    const cell = get(zone, b.i);
                    if (!cell)
                      return (
                        <td key={b.i} className="text-muted-foreground p-2">
                          —
                        </td>
                      );
                    const up = cell.coef > 1.001;
                    const down = cell.coef < 0.999;
                    return (
                      <td
                        key={b.i}
                        className="p-1.5"
                        style={{ background: cellColor(cell.coef) }}
                        title={`signal ${cell.signal >= 0 ? "+" : ""}${cell.signal.toFixed(2)} · ${cell.n_obs} courses · maj ${new Date(cell.updated_at).toLocaleDateString("fr")}`}
                      >
                        <div className="flex items-center justify-center gap-1 font-bold">
                          {cell.coef.toFixed(3)}
                          {up && (
                            <TrendingUp className="size-3 text-[#E5484D]" />
                          )}
                          {down && (
                            <TrendingDown className="size-3 text-[#1E88E5]" />
                          )}
                        </div>
                        <span className="text-muted-foreground text-nano block">
                          n={cell.n_obs}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-muted-foreground text-caption mt-2">
            Survole une case : signal, nombre de courses, dernière mise à jour.
            Recalcul automatique chaque nuit (cron Drive).
          </p>
        </div>
      )}
    </div>
  );
}
