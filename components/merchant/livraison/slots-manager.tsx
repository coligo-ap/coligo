"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import {
  createSlot,
  deleteSlot,
  setSlotStatus,
  type SlotActionState,
} from "@/app/(merchant)/livraison/creneaux/actions";

type Slot = {
  id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  max_orders: number;
  status: "open" | "closed" | "cancelled";
  used: number;
};

const initial: SlotActionState = {};

export function SlotsManager({ slots }: { slots: Slot[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [state, action, pending] = useActionState(createSlot, initial);

  if (state.ok && adding) {
    setTimeout(() => {
      setAdding(false);
      router.refresh();
    }, 0);
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {slots.map((s) => (
          <SlotRow key={s.id} slot={s} />
        ))}
        {slots.length === 0 && (
          <li className="text-muted text-sm">
            Aucun créneau à venir. Crée le premier ci-dessous.
          </li>
        )}
      </ul>

      <Button type="button" onClick={() => setAdding(true)}>
        <Plus className="size-4" />
        Nouveau créneau
      </Button>

      {/* Modal de création — overlay centré plutôt qu'un formulaire inline qui
          allonge la page (surtout sur mobile, où les 4 champs s'empilaient). */}
      {adding && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => !pending && setAdding(false)}
        >
          <form
            action={action}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface w-full max-w-sm space-y-4 rounded-[16px] p-5 shadow-xl"
          >
            <h2 className="text-base font-semibold">Nouveau créneau</h2>
            <div className="space-y-1.5">
              <Label htmlFor="slot_date">Date</Label>
              <Input
                id="slot_date"
                name="slot_date"
                type="date"
                required
                disabled={pending}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="start_time">Début</Label>
                <Input
                  id="start_time"
                  name="start_time"
                  type="time"
                  required
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end_time">Fin</Label>
                <Input
                  id="end_time"
                  name="end_time"
                  type="time"
                  required
                  disabled={pending}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="max_orders">Capacité (commandes max)</Label>
              <Input
                id="max_orders"
                name="max_orders"
                type="number"
                min={1}
                max={500}
                defaultValue={10}
                required
                disabled={pending}
              />
            </div>
            {state.error && (
              <p className="text-danger-600 text-sm">{state.error}</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={pending} className="flex-1">
                {pending && <Loader2 className="size-4 animate-spin" />}
                Créer
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setAdding(false)}
                disabled={pending}
              >
                Annuler
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function SlotRow({ slot }: { slot: Slot }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const full = slot.used >= slot.max_orders;
  const tone =
    slot.status === "cancelled"
      ? "bg-danger-50 border-danger-200 text-danger-700"
      : slot.status === "closed"
        ? "bg-surface-2 border-border"
        : full
          ? "bg-warning-50 border-warning-200"
          : "bg-success-50 border-success-200";
  return (
    <li
      className={
        "flex items-center gap-3 rounded-[12px] border px-4 py-2.5 text-sm " +
        tone
      }
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold tabular-nums">
          {new Date(slot.slot_date).toLocaleDateString("fr-FR", {
            weekday: "short",
            day: "2-digit",
            month: "short",
          })}{" "}
          · {slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}
        </p>
        <p className="text-muted text-xs tabular-nums">
          {slot.used}/{slot.max_orders} commandes · {labelStatus(slot.status)}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {slot.status === "open" && (
          <Button
            size="sm"
            type="button"
            variant="secondary"
            onClick={() =>
              start(async () => {
                const r = await setSlotStatus(slot.id, "closed");
                if (r.error) toast.error(r.error);
                router.refresh();
              })
            }
            disabled={pending}
          >
            Fermer
          </Button>
        )}
        {slot.status === "closed" && (
          <Button
            size="sm"
            type="button"
            variant="secondary"
            onClick={() =>
              start(async () => {
                const r = await setSlotStatus(slot.id, "open");
                if (r.error) toast.error(r.error);
                router.refresh();
              })
            }
            disabled={pending}
          >
            Ré-ouvrir
          </Button>
        )}
        {slot.status !== "cancelled" && (
          <Button
            size="sm"
            type="button"
            variant="secondary"
            onClick={() => {
              if (!confirm("Annuler ce créneau ?")) return;
              start(async () => {
                const r = await setSlotStatus(slot.id, "cancelled");
                if (r.error) toast.error(r.error);
                router.refresh();
              });
            }}
            disabled={pending}
          >
            <X className="size-3.5" />
          </Button>
        )}
        <Button
          size="sm"
          type="button"
          variant="secondary"
          onClick={() => {
            if (!confirm("Supprimer définitivement ?")) return;
            start(async () => {
              const r = await deleteSlot(slot.id);
              if (r.error) toast.error(r.error);
              router.refresh();
            });
          }}
          disabled={pending}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

function labelStatus(s: Slot["status"]): string {
  switch (s) {
    case "open":
      return "Ouvert";
    case "closed":
      return "Fermé";
    case "cancelled":
      return "Annulé";
  }
}
