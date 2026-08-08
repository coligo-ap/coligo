"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfoHint } from "@/components/ui/info-hint";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
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
  example?: string;
}[] = [
  {
    name: "commission_cash",
    label: "Commission — Cash (%)",
    hint: "Commission Coligo sur les PRODUITS d'une commande payée en espèces.",
    example: "5 % → sur 1000 DA de produits, Coligo prend 50 DA.",
  },
  {
    name: "commission_online",
    label: "Commission — En ligne (%)",
    hint: "Commission Coligo sur les produits d'une commande payée en ligne (carte / Coligo Pay).",
    example: "8 % → sur 1000 DA de produits, Coligo prend 80 DA.",
  },
  {
    name: "cashback_online",
    label: "Cashback — En ligne (%)",
    hint: "Crédit Coligo Pay reversé au client sur une commande payée en ligne. Pris sur la commission, pas un coût en plus.",
    example: "2 % → sur 1000 DA, le client gagne 20 DA de cashback.",
  },
  {
    name: "cashback_cash",
    label: "Cashback — Cash (%)",
    hint: "Idem cashback, mais pour les commandes payées en espèces.",
    example: "1 % → sur 1000 DA, 10 DA de cashback client.",
  },
  {
    name: "chargily_fee",
    label: "Frais Chargily (%)",
    hint: "Frais du prestataire de paiement carte (Chargily), à la charge de Coligo. 0 % en formule Startup.",
    example: "1,5 % → sur un paiement carte de 1000 DA, 15 DA de frais.",
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
  const fb = useFormActionFeedback({
    pending,
    ok: state.ok,
    error: state.error,
  });

  useEffect(() => {
    // Succès porté par le bouton (ActionButton) — pas de toast. On rafraîchit
    // seulement les données serveur.
    if (state.ok) router.refresh();
  }, [state, router]);

  return (
    <form
      action={formAction}
      className="border-border bg-surface space-y-4 rounded-lg border p-5"
    >
      <div
        role="note"
        className="border-warning-100 bg-warning-50 text-warning-700 flex items-start gap-2.5 rounded-md border px-4 py-3 text-xs"
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
            <Label className="flex items-center gap-1">
              {f.label}
              {f.hint && (
                <InfoHint title={f.label} text={f.hint} example={f.example} />
              )}
            </Label>
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
          </div>
        ))}
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1">
            Seuil de dette (DA)
            <InfoHint
              title="Seuil de dette"
              text="Dette max d'un commerçant (commissions dues à Coligo) avant blocage des nouvelles commandes."
              example="5000 → au-delà de 5000 DA dus, le commerçant est bloqué jusqu'au règlement."
            />
          </Label>
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
            <Label className="flex items-center gap-1">
              Base (DA)
              <InfoHint
                title="Base"
                text="Montant fixe de départ de chaque livraison, avant d'ajouter le prix au km."
                example="100 → toute livraison commence à 100 DA, puis on ajoute la distance."
              />
            </Label>
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
            <Label className="flex items-center gap-1">
              Prix au km (DA)
              <InfoHint
                title="Prix au km"
                text="Montant ajouté par kilomètre facturable (au-delà du seuil de km gratuits)."
                example="25 → 4 km facturables ajoutent 100 DA à la base."
              />
            </Label>
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
            <Label className="flex items-center gap-1">
              Seuil km gratuits (km)
              <InfoHint
                title="Seuil km gratuits"
                text="Nombre de km offerts avant de facturer le prix au km. Distance facturable = distance − ce seuil (jamais négatif)."
                example="2 → les 2 premiers km ne sont pas facturés ; à 5 km on facture 3 km."
              />
            </Label>
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
            <Label className="flex items-center gap-1">
              Rayon max (km)
              <InfoHint
                title="Rayon max"
                text="Distance de livraison maximale qu'un commerçant peut configurer pour sa boutique."
                example="10 → un commerçant ne peut pas accepter de livraison au-delà de 10 km."
              />
            </Label>
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
            <Label className="flex items-center gap-1">
              Plancher (DA)
              <InfoHint
                title="Plancher livraison"
                text="Prix de livraison minimum, même pour une adresse très proche."
                example="80 → une livraison n'est jamais facturée moins de 80 DA."
              />
            </Label>
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
            <Label className="flex items-center gap-1">
              Plafond (DA)
              <InfoHint
                title="Plafond livraison"
                text="Prix de livraison maximum, même pour une adresse très éloignée."
                example="400 → une livraison n'est jamais facturée plus de 400 DA."
              />
            </Label>
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
            <Label className="flex items-center gap-1">
              Commission tournée (%)
              <InfoHint
                title="Commission tournée"
                text="Part prélevée par Coligo sur les FRAIS DE LIVRAISON des commandes en tournée (pas l'express, pas les produits)."
                example="20 % → sur 200 DA de frais de livraison en tournée, Coligo prend 40 DA."
              />
            </Label>
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

      <ActionButton
        type="submit"
        state={fb}
        labels={{ idle: "Enregistrer", success: "Taux mis à jour ✓" }}
      />
    </form>
  );
}
