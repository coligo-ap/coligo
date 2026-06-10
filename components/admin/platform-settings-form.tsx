"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import type { PlatformSettings } from "@/lib/types";
import { rateToPct } from "@/lib/validation/platform";
import {
  updatePlatformSettings,
  type AdminFormState,
} from "@/app/admin/actions";

const initialState: AdminFormState = {};

const RATE_FIELDS: {
  name: keyof PlatformSettings;
  label: string;
  hint?: string;
}[] = [
  { name: "commission_cash", label: "Commission — Cash (%)" },
  { name: "commission_online", label: "Commission — En ligne (%)" },
  { name: "cashback_online", label: "Cashback — En ligne (%)" },
  { name: "cashback_cash", label: "Cashback — Cash (%)" },
  {
    name: "chargily_fee",
    label: "Frais Chargily (%)",
    hint: "Coût Coligo (global, 0 % en formule Startup).",
  },
];

export function PlatformSettingsForm({
  settings,
}: {
  settings: PlatformSettings;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    updatePlatformSettings,
    initialState
  );

  useEffect(() => {
    if (state.ok) {
      toast.success("Taux mis à jour");
      router.refresh();
    }
  }, [state, router]);

  return (
    <form
      action={formAction}
      className="border-border bg-surface space-y-4 rounded-[16px] border p-5"
    >
      <div
        role="note"
        className="border-warning-100 bg-warning-50 text-warning-700 flex items-start gap-2.5 rounded-[12px] border px-4 py-3 text-xs"
      >
        <AlertTriangle className="text-warning-600 mt-0.5 size-4 shrink-0" />
        <p>
          Les nouveaux taux s&apos;appliquent <strong>uniquement</strong> aux
          commandes complétées à partir de leur enregistrement. Les commandes
          passées conservent les taux qui étaient en vigueur au moment de leur
          complétion (snapshot figé).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {RATE_FIELDS.map((f) => (
          <div key={f.name} className="space-y-1.5">
            <Label>{f.label}</Label>
            <Input
              type="number"
              name={f.name}
              defaultValue={rateToPct(settings[f.name] as number)}
              min={0}
              max={100}
              step="0.01"
              required
              disabled={pending}
            />
            {f.hint && <p className="text-subtle text-xs">{f.hint}</p>}
          </div>
        ))}
        <div className="space-y-1.5">
          <Label>Seuil de dette (DA)</Label>
          <Input
            type="number"
            name="max_debt_da"
            defaultValue={settings.max_debt_da}
            min={0}
            step={1}
            required
            disabled={pending}
          />
        </div>
      </div>

      <div className="border-border space-y-3 border-t pt-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Barème de livraison
          </h2>
          <p className="text-subtle text-xs">
            Tarif imposé par la plateforme. Le commerçant n&apos;y a pas accès
            en écriture ; il choisit seulement son rayon (≤ rayon max) et ses
            modes.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Base (DA)</Label>
            <Input
              type="number"
              name="delivery_base_da"
              defaultValue={settings.delivery_base_da}
              min={0}
              step={1}
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Prix au km (DA)</Label>
            <Input
              type="number"
              name="delivery_per_km_da"
              defaultValue={settings.delivery_per_km_da}
              min={0}
              step={1}
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Seuil km gratuits (km)</Label>
            <Input
              type="number"
              name="delivery_free_km_threshold"
              defaultValue={settings.delivery_free_km_threshold}
              min={0}
              step="0.1"
              required
              disabled={pending}
            />
            <p className="text-subtle text-xs">
              Distance facturable = max(0, distance − ce seuil).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Rayon max (km)</Label>
            <Input
              type="number"
              name="delivery_max_radius_km"
              defaultValue={settings.delivery_max_radius_km}
              min={0.1}
              step="0.1"
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Plancher (DA)</Label>
            <Input
              type="number"
              name="delivery_min_da"
              defaultValue={settings.delivery_min_da}
              min={0}
              step={1}
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Plafond (DA)</Label>
            <Input
              type="number"
              name="delivery_max_da"
              defaultValue={settings.delivery_max_da}
              min={0}
              step={1}
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Commission tournée (%)</Label>
            <Input
              type="number"
              name="tour_delivery_commission_rate"
              defaultValue={rateToPct(settings.tour_delivery_commission_rate)}
              min={0}
              max={100}
              step="0.01"
              required
              disabled={pending}
            />
            <p className="text-subtle text-xs">
              Part prélevée par Coligo sur les frais de livraison des commandes
              en <strong>tournée</strong> (payée par le commerçant, qui fixe
              lui-même son prix de livraison ≤ barème). N&apos;affecte ni
              l&apos;express ni la commission sur les produits.
            </p>
          </div>
        </div>
      </div>

      {state.error && <p className="text-danger-600 text-sm">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Enregistrer
      </Button>
    </form>
  );
}
