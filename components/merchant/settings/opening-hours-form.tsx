"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Info, Moon, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { cn } from "@/lib/utils";
import {
  DAY_KEYS,
  DAY_LABELS,
  EMPTY_OPENING_HOURS,
  type DayKey,
  type OpeningHours,
  type OpeningSlot,
} from "@/lib/types";
import { normalizeOpeningHours } from "@/lib/merchant/opening-hours";
import {
  updateOpeningHours,
  type SettingsFormState,
} from "@/app/(merchant)/settings/actions";
import { isOvernight } from "@/lib/merchant/opening-hours";

const initial: SettingsFormState = {};

const DEFAULT_SLOT: OpeningSlot = { open: "09:00", close: "18:00" };

export function OpeningHoursForm({
  initial: initialHours,
}: {
  initial: OpeningHours;
}) {
  const router = useRouter();
  const [hours, setHours] = useState<OpeningHours>(() =>
    normalizeOpeningHours(initialHours ?? EMPTY_OPENING_HOURS)
  );
  const [state, formAction, pending] = useActionState(
    updateOpeningHours,
    initial
  );

  const btnState = useFormActionFeedback({
    pending,
    ok: state.ok,
    error: state.error,
  });
  const [note, setNote] = useActionNote();
  useEffect(() => {
    if (state.ok && !pending) router.refresh();
  }, [state.ok, pending, router]);

  function addSlot(day: DayKey) {
    setHours((h) => ({ ...h, [day]: [...h[day], { ...DEFAULT_SLOT }] }));
  }

  function removeSlot(day: DayKey, idx: number) {
    setHours((h) => ({
      ...h,
      [day]: h[day].filter((_, i) => i !== idx),
    }));
  }

  function patchSlot(
    day: DayKey,
    idx: number,
    field: "open" | "close",
    value: string
  ) {
    setHours((h) => ({
      ...h,
      [day]: h[day].map((s, i) => (i === idx ? { ...s, [field]: value } : s)),
    }));
  }

  function copyToAll(day: DayKey) {
    const src = hours[day];
    setHours(
      Object.fromEntries(
        DAY_KEYS.map((d) => [d, src.map((s) => ({ ...s }))])
      ) as OpeningHours
    );
    setNote({ ok: true, text: "Horaires copiés sur tous les jours" });
  }

  return (
    <form action={formAction} className="space-y-3">
      {/* Champ caché : JSON sérialisé envoyé à la Server Action */}
      <input type="hidden" name="hours" value={JSON.stringify(hours)} />

      {/* Hint général compact — l'horaire de nuit est signalé par le badge
          « jusqu'au lendemain » directement sur le créneau concerné. */}
      <p className="text-muted flex items-start gap-1.5 text-xs">
        <Info className="text-primary-600 mt-0.5 size-3.5 shrink-0" />
        <span>
          Aucun créneau = jour fermé. Un créneau qui dépasse minuit (ex. 18:00 →
          02:00) est compris automatiquement. « Copier » applique la journée à
          tous les jours.
        </span>
      </p>

      <div className="space-y-2">
        {DAY_KEYS.map((day) => {
          const slots = hours[day];
          const closed = slots.length === 0;
          return (
            <div
              key={day}
              className={cn(
                "border-border bg-surface rounded-[12px] border p-3",
                closed && "bg-surface-2"
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-foreground text-sm font-semibold">
                  {DAY_LABELS[day].long}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => copyToAll(day)}
                    disabled={pending || closed}
                    className="text-muted hover:text-foreground hover:bg-surface-2 inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[11px] disabled:opacity-40"
                    title="Copier sur tous les jours"
                  >
                    <Copy className="size-3" />
                    Copier
                  </button>
                  <button
                    type="button"
                    onClick={() => addSlot(day)}
                    disabled={pending || slots.length >= 4}
                    className="text-primary-700 hover:bg-primary-50 inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[11px] font-medium disabled:opacity-40"
                  >
                    <Plus className="size-3" />
                    Créneau
                  </button>
                </div>
              </div>

              {closed ? (
                <p className="text-subtle text-xs">Fermé</p>
              ) : (
                <div className="space-y-1.5">
                  {slots.map((s, i) => {
                    const overnight = isOvernight(s);
                    const invalid = s.open === s.close;
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <TimeInput
                            value={s.open}
                            onChange={(v) => patchSlot(day, i, "open", v)}
                            disabled={pending}
                          />
                          <span className="text-muted text-xs">→</span>
                          <TimeInput
                            value={s.close}
                            onChange={(v) => patchSlot(day, i, "close", v)}
                            disabled={pending}
                          />
                          {overnight && !invalid && (
                            <span
                              className="bg-primary-50 text-primary-700 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              title="Ce créneau se termine le lendemain"
                            >
                              <Moon className="size-3" />
                              jusqu&apos;au lendemain
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeSlot(day, i)}
                            disabled={pending}
                            className="text-danger-600 hover:bg-danger-50 ml-auto rounded-[8px] p-1.5"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        {invalid && (
                          <p className="text-danger-600 text-[11px]">
                            L&apos;ouverture et la fermeture doivent être
                            différentes.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {state.error && btnState === "error" && (
        <p className="text-danger-600 text-sm">{state.error}</p>
      )}

      <ActionNote note={note} />

      <ActionButton
        type="submit"
        state={btnState}
        labels={{
          idle: "Enregistrer les horaires",
          pending: "Enregistrement…",
          success: "Horaires enregistrés ✓",
          error: "Erreur, réessaie",
        }}
      />
    </form>
  );
}

function TimeInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      step={300}
      className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 h-9 rounded-[10px] border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
    />
  );
}
