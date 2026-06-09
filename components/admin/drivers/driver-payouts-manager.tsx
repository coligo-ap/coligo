"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import {
  upsertDriverPayoutMethod,
  deleteDriverPayoutMethod,
} from "@/app/admin/drivers/actions";
import type { AdminFormState } from "@/app/admin/actions";

export type DriverPayout = {
  id: string;
  method: string;
  label: string | null;
  account_number: string | null;
  account_name: string | null;
  is_default: boolean;
};

const METHODS = [
  ["especes", "Espèces"],
  ["ccp", "CCP"],
  ["baridimob", "BaridiMob"],
  ["virement", "Virement bancaire"],
] as const;

const methodLabel = (m: string) => METHODS.find(([v]) => v === m)?.[1] ?? m;

export function DriverPayoutsManager({
  driverId,
  methods,
}: {
  driverId: string;
  methods: DriverPayout[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [delPending, startDel] = useTransition();
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(
    upsertDriverPayoutMethod.bind(null, driverId),
    {}
  );

  useEffect(() => {
    if (state.ok) {
      toast.success("Moyen de versement enregistré");
      setAdding(false);
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <div className="space-y-3">
      {methods.length === 0 && (
        <p className="text-muted text-sm">Aucun moyen de versement.</p>
      )}

      {methods.map((m) => (
        <div
          key={m.id}
          className="border-border flex items-start justify-between gap-3 rounded-[12px] border p-3"
        >
          <div className="min-w-0 text-sm">
            <p className="flex items-center gap-1.5 font-semibold">
              {methodLabel(m.method)}
              {m.is_default && (
                <span className="bg-primary-50 text-primary-700 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold">
                  <Star className="size-3" /> Défaut
                </span>
              )}
            </p>
            {m.label && <p className="text-muted text-xs">{m.label}</p>}
            <p className="text-muted tabular-nums">
              {m.account_number ?? "—"}
              {m.account_name ? ` · ${m.account_name}` : ""}
            </p>
          </div>
          <button
            type="button"
            aria-label="Supprimer"
            className="text-danger-600 hover:bg-danger-50 rounded-[8px] p-1.5"
            disabled={delPending}
            onClick={() => {
              if (!confirm("Supprimer ce moyen de versement ?")) return;
              startDel(async () => {
                const r = await deleteDriverPayoutMethod(driverId, m.id);
                if (r.error) toast.error(r.error);
                else {
                  toast.success("Moyen supprimé");
                  router.refresh();
                }
              });
            }}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}

      {adding ? (
        <form
          action={formAction}
          className="border-border space-y-3 rounded-[12px] border border-dashed p-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="method" className="mb-1 block text-xs">
                Moyen *
              </Label>
              <select
                id="method"
                name="method"
                required
                className="border-border bg-surface h-10 w-full rounded-[10px] border px-3 text-sm"
              >
                {METHODS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="label" className="mb-1 block text-xs">
                Libellé
              </Label>
              <Input id="label" name="label" placeholder="Compte perso" />
            </div>
            <div>
              <Label htmlFor="account_number" className="mb-1 block text-xs">
                N° de compte / CCP / RIP
              </Label>
              <Input id="account_number" name="account_number" />
            </div>
            <div>
              <Label htmlFor="account_name" className="mb-1 block text-xs">
                Titulaire
              </Label>
              <Input id="account_name" name="account_name" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_default" className="size-4" />
            Définir comme moyen par défaut
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Ajouter
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setAdding(false)}
            >
              Annuler
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setAdding(true)}
        >
          <Plus className="size-4" />
          Ajouter un moyen
        </Button>
      )}
    </div>
  );
}
