"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  setTourSchedule,
  type ScheduleActionState,
} from "@/app/(merchant)/livraison/creneaux/actions";

export type ScheduleRange = {
  weekday: number;
  start_time: string;
  end_time: string;
  max_orders: number;
};

type Range = { start_time: string; end_time: string; max_orders: number };

// Affichage lundi → dimanche, mais on stocke weekday 0=dim … 6=sam.
const DAYS: { weekday: number; label: string }[] = [
  { weekday: 1, label: "Lundi" },
  { weekday: 2, label: "Mardi" },
  { weekday: 3, label: "Mercredi" },
  { weekday: 4, label: "Jeudi" },
  { weekday: 5, label: "Vendredi" },
  { weekday: 6, label: "Samedi" },
  { weekday: 0, label: "Dimanche" },
];

function groupByDay(rows: ScheduleRange[]): Record<number, Range[]> {
  const out: Record<number, Range[]> = {};
  for (const d of DAYS) out[d.weekday] = [];
  for (const r of rows) {
    (out[r.weekday] ??= []).push({
      start_time: r.start_time.slice(0, 5),
      end_time: r.end_time.slice(0, 5),
      max_orders: r.max_orders,
    });
  }
  for (const k of Object.keys(out)) {
    out[Number(k)].sort((a, b) => a.start_time.localeCompare(b.start_time));
  }
  return out;
}

export function TourScheduleEditor({
  initial,
  disabled,
}: {
  initial: ScheduleRange[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [days, setDays] = useState<Record<number, Range[]>>(() =>
    groupByDay(initial)
  );
  const [state, setState] = useState<ScheduleActionState>({});
  const [pending, start] = useTransition();

  const addRange = (weekday: number) => {
    setState({});
    setDays((prev) => ({
      ...prev,
      [weekday]: [
        ...(prev[weekday] ?? []),
        { start_time: "09:00", end_time: "12:00", max_orders: 10 },
      ],
    }));
  };

  const updateRange = (weekday: number, idx: number, patch: Partial<Range>) => {
    setDays((prev) => {
      const list = [...(prev[weekday] ?? [])];
      list[idx] = { ...list[idx], ...patch };
      return { ...prev, [weekday]: list };
    });
  };

  const removeRange = (weekday: number, idx: number) => {
    setDays((prev) => ({
      ...prev,
      [weekday]: (prev[weekday] ?? []).filter((_, i) => i !== idx),
    }));
  };

  const save = () => {
    setState({});
    const rows: ScheduleRange[] = [];
    for (const d of DAYS) {
      for (const r of days[d.weekday] ?? []) {
        rows.push({
          weekday: d.weekday,
          start_time: r.start_time,
          end_time: r.end_time,
          max_orders: r.max_orders,
        });
      }
    }
    start(async () => {
      const res = await setTourSchedule(JSON.stringify(rows));
      setState(res);
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <ul className="space-y-2.5">
        {DAYS.map((d) => {
          const ranges = days[d.weekday] ?? [];
          return (
            <li
              key={d.weekday}
              className="border-border bg-surface rounded-[14px] border p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{d.label}</p>
                <Button
                  size="sm"
                  type="button"
                  variant="secondary"
                  onClick={() => addRange(d.weekday)}
                  disabled={disabled || pending}
                >
                  <Plus className="size-4" />
                  Plage
                </Button>
              </div>

              {ranges.length === 0 ? (
                <p className="text-muted mt-2 text-xs">
                  Aucune sortie ce jour.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {ranges.map((r, idx) => (
                    <div
                      key={idx}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <Input
                        type="time"
                        value={r.start_time}
                        onChange={(e) =>
                          updateRange(d.weekday, idx, {
                            start_time: e.target.value,
                          })
                        }
                        disabled={disabled || pending}
                        className="w-[110px]"
                        aria-label={`${d.label} — début`}
                      />
                      <span className="text-muted text-sm">→</span>
                      <Input
                        type="time"
                        value={r.end_time}
                        onChange={(e) =>
                          updateRange(d.weekday, idx, {
                            end_time: e.target.value,
                          })
                        }
                        disabled={disabled || pending}
                        className="w-[110px]"
                        aria-label={`${d.label} — fin`}
                      />
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          min={1}
                          max={500}
                          value={r.max_orders}
                          onChange={(e) =>
                            updateRange(d.weekday, idx, {
                              max_orders: Number(e.target.value) || 1,
                            })
                          }
                          disabled={disabled || pending}
                          className="w-[80px] tabular-nums"
                          aria-label={`${d.label} — capacité`}
                        />
                        <span className="text-subtle text-xs whitespace-nowrap">
                          cmd max
                        </span>
                      </div>
                      <Button
                        size="sm"
                        type="button"
                        variant="secondary"
                        onClick={() => removeRange(d.weekday, idx)}
                        disabled={disabled || pending}
                        aria-label="Supprimer la plage"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {state.error && <p className="text-danger-600 text-sm">{state.error}</p>}
      {state.ok && (
        <p className="text-success-700 flex items-center gap-1.5 text-sm">
          <Check className="size-4" />
          Planning enregistré.
        </p>
      )}

      <Button type="button" onClick={save} disabled={disabled || pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Enregistrer le planning
      </Button>
    </div>
  );
}
