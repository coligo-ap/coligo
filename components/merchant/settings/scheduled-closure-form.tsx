"use client";

import { useState, useTransition } from "react";
import { CalendarClock, Loader2, Save, Trash2 } from "lucide-react";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { setScheduledClosure } from "@/app/(merchant)/actions";

/**
 * Fermeture PROGRAMMÉE (congés, travaux) sur une plage de dates. Pour une
 * coupure courte (≤ la journée), le commerçant utilise plutôt le bouton de
 * statut du header (Pause / Fermer aujourd'hui). Ici on planifie une fermeture
 * de plusieurs jours, à l'avance.
 *
 * Les `datetime-local` sont interprétés dans le fuseau de l'appareil (Algérie),
 * et envoyés en ISO. Le client ne pourra pas commander pour un créneau tombant
 * dans cette plage (cf. checkout).
 */
function toInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function ScheduledClosureForm({
  initialStart,
  initialEnd,
}: {
  initialStart: string | null;
  initialEnd: string | null;
}) {
  const [start, setStart] = useState(toInput(initialStart));
  const [end, setEnd] = useState(toInput(initialEnd));
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useActionNote();
  const hasClosure = Boolean(initialStart && initialEnd);

  function save() {
    if (!start || !end) {
      setNote({ ok: false, text: "Indiquez une date de début ET de fin." });
      return;
    }
    const startIso = new Date(start).toISOString();
    const endIso = new Date(end).toISOString();
    startTransition(async () => {
      const r = await setScheduledClosure(startIso, endIso);
      if (!r.ok) {
        setNote({ ok: false, text: r.error ?? "Échec de l'enregistrement." });
        return;
      }
      setNote({ ok: true, text: "Fermeture programmée enregistrée." });
    });
  }

  function clear() {
    startTransition(async () => {
      const r = await setScheduledClosure(null, null);
      if (!r.ok) {
        setNote({ ok: false, text: r.error ?? "Échec." });
        return;
      }
      setStart("");
      setEnd("");
      setNote({ ok: true, text: "Fermeture programmée annulée." });
    });
  }

  return (
    <div className="border-border bg-surface-2 mt-4 rounded-[12px] border p-3.5">
      <div className="mb-2.5 flex items-center gap-2">
        <CalendarClock className="text-muted size-4" />
        <h3 className="text-sm font-semibold">Fermeture programmée (congés)</h3>
      </div>
      <p className="text-muted mb-3 text-xs">
        Fermez votre commerce sur plusieurs jours à l&apos;avance. Les clients
        ne pourront pas commander pour cette période.
      </p>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-muted mb-1 block text-xs font-medium">Du</span>
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="border-border-strong focus:ring-primary-400 h-10 w-full rounded-[10px] border bg-white px-3 text-sm focus:ring-2 focus:outline-none"
          />
        </label>
        <label className="text-sm">
          <span className="text-muted mb-1 block text-xs font-medium">Au</span>
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="border-border-strong focus:ring-primary-400 h-10 w-full rounded-[10px] border bg-white px-3 text-sm focus:ring-2 focus:outline-none"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="bg-primary-600 hover:bg-primary-700 inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Programmer
        </button>
        {hasClosure && (
          <button
            type="button"
            onClick={clear}
            disabled={pending}
            className="text-danger-700 hover:bg-danger-50 inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-sm font-medium disabled:opacity-60"
          >
            <Trash2 className="size-4" />
            Annuler la fermeture
          </button>
        )}
      </div>

      <ActionNote note={note} className="mt-2" />
    </div>
  );
}
