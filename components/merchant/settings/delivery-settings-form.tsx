"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Truck, Calendar, Bolt, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import { MapPositionPicker } from "@/components/shared/map-position-picker";
import { cn } from "@/lib/utils";
import { computeDeliveryFee, tourBandCeilingDa } from "@/lib/delivery/pricing";
import { formatDA } from "@/lib/utils";
import type { DeliveryPricing, MerchantDeliverySettings } from "@/lib/types";

export type TourZoneInput = {
  band_index: number;
  max_km: number;
  price_da: number;
};
import {
  setDeliverySettings,
  type SettingsFormState,
} from "@/app/(merchant)/settings/actions";

const initial: SettingsFormState = {};

export function DeliverySettingsForm({
  pricing,
  current,
  zones,
}: {
  pricing: DeliveryPricing;
  current: MerchantDeliverySettings & {
    latitude: number | null;
    longitude: number | null;
  };
  zones: TourZoneInput[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    setDeliverySettings,
    initial
  );

  const [enabled, setEnabled] = useState(current.delivery_enabled);
  const [express, setExpress] = useState(current.express_enabled);
  const [tours, setTours] = useState(current.tours_enabled);
  const [radius, setRadius] = useState<number>(
    current.delivery_radius_km ?? Math.min(5, pricing.delivery_max_radius_km)
  );
  const [simKm, setSimKm] = useState<number>(3);
  // Prix tournée par bande (édités par le commerçant, plafonnés au barème).
  const [zonePrices, setZonePrices] = useState<number[]>(() =>
    [...zones]
      .sort((a, b) => a.band_index - b.band_index)
      .map((z) => z.price_da)
  );
  const sortedZones = useMemo(
    () => [...zones].sort((a, b) => a.band_index - b.band_index),
    [zones]
  );
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(
    current.latitude != null && current.longitude != null
      ? { lat: current.latitude, lng: current.longitude }
      : null
  );
  const positionMissing = enabled && !position;

  const btnState = useFormActionFeedback({
    pending,
    ok: state.ok,
    error: state.error,
  });
  useEffect(() => {
    if (state.ok && !pending) router.refresh();
  }, [state.ok, pending, router]);

  const quote = useMemo(
    () => computeDeliveryFee(simKm, pricing, radius),
    [simKm, pricing, radius]
  );

  return (
    <form action={formAction} className="space-y-5">
      {/* Switch principal — checkbox cachée + UI custom pour cohérence visuelle
          mais le submit FormData utilise toujours `on`/absent. */}
      <Switch
        name="delivery_enabled"
        label="Activer la livraison"
        description="Les clients peuvent se faire livrer au checkout."
        icon={<Truck className="size-4" />}
        checked={enabled}
        onChange={setEnabled}
      />

      {enabled && (
        <>
          {/* Modes */}
          <div className="border-border space-y-3 rounded-[12px] border p-4">
            <p className="text-sm font-semibold">Modes de livraison</p>
            <Switch
              name="express_enabled"
              label="Express"
              description="Livraison immédiate dès qu'un livreur est disponible."
              icon={<Bolt className="size-4" />}
              checked={express}
              onChange={setExpress}
            />
            <Switch
              name="tours_enabled"
              label="Tournée"
              description="Créneaux planifiés avec capacité max par créneau."
              icon={<Calendar className="size-4" />}
              checked={tours}
              onChange={setTours}
            />
            {!express && !tours && (
              <p className="text-danger-600 text-xs">
                Active au moins un mode pour valider.
              </p>
            )}
          </div>

          {/* Position du commerçant (obligatoire pour la livraison) */}
          <div className="border-border space-y-3 rounded-[12px] border p-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold">
                <MapPin className="size-4" />
                Position de la boutique
              </p>
              <p className="text-muted text-xs">
                Place le pointeur exactement sur ta vitrine (ou « Ma position »
                pour utiliser ton GPS).
              </p>
            </div>
            {positionMissing && (
              <p className="border-warning-200 bg-warning-50 text-warning-700 flex items-start gap-2 rounded-[10px] border px-3 py-2 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Position non définie — confirme l&apos;emplacement de ta
                boutique pour enregistrer la livraison.
              </p>
            )}
            <MapPositionPicker
              initial={position}
              onChange={(p) => setPosition(p)}
              gpsLabel="Ma boutique"
            />
            {position && (
              <p className="text-subtle text-xs tabular-nums">
                Coordonnées : {position.lat.toFixed(5)},{" "}
                {position.lng.toFixed(5)}
              </p>
            )}
            <input type="hidden" name="latitude" value={position?.lat ?? ""} />
            <input type="hidden" name="longitude" value={position?.lng ?? ""} />
          </div>

          {/* Rayon */}
          <div className="border-border space-y-3 rounded-[12px] border p-4">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="delivery_radius_km">Rayon de livraison</Label>
              <span className="text-sm font-semibold tabular-nums">
                {radius.toFixed(1)} km
              </span>
            </div>
            <input
              id="delivery_radius_km"
              name="delivery_radius_km"
              type="range"
              min={0.5}
              max={pricing.delivery_max_radius_km}
              step={0.5}
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="w-full"
              disabled={pending}
            />
            <p className="text-subtle text-xs">
              Maximum plateforme :{" "}
              <strong>{pricing.delivery_max_radius_km} km</strong>.
            </p>
          </div>

          {/* Tarifs de TOURNÉE par zone (le commerçant fixe son prix ≤ plafond) */}
          {tours && (
            <div className="border-border space-y-3 rounded-[12px] border p-4">
              <div className="flex items-center gap-2">
                <Calendar className="size-4" />
                <p className="text-sm font-semibold">
                  Tarifs de tournée par zone
                </p>
              </div>
              <p className="text-muted text-xs">
                Ton prix par tranche de distance — tu peux baisser, jamais
                dépasser le plafond plateforme.
              </p>
              {sortedZones.map((z, i) => {
                const ceiling = tourBandCeilingDa(z.max_km, pricing);
                const lowKm = i === 0 ? 0 : sortedZones[i - 1].max_km;
                return (
                  <div
                    key={z.band_index}
                    className="flex items-center justify-between gap-3"
                  >
                    <Label
                      htmlFor={`zone_price_${z.band_index}`}
                      className="text-xs"
                    >
                      De {lowKm} à {z.max_km} km
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`zone_price_${z.band_index}`}
                        name={`zone_price_${z.band_index}`}
                        type="number"
                        min={pricing.delivery_min_da}
                        max={ceiling}
                        step="10"
                        value={zonePrices[i] ?? z.price_da}
                        onChange={(e) => {
                          const next = [...zonePrices];
                          next[i] = Number(e.target.value) || 0;
                          setZonePrices(next);
                        }}
                        className="max-w-[110px] tabular-nums"
                        disabled={pending}
                      />
                      <span className="text-subtle text-xs whitespace-nowrap">
                        DA · max {formatDA(ceiling)}
                      </span>
                    </div>
                  </div>
                );
              })}
              {zonePrices.some(
                (p, i) =>
                  p > tourBandCeilingDa(sortedZones[i]?.max_km ?? 0, pricing)
              ) && (
                <p className="text-warning-700 text-xs">
                  Un prix dépasse le plafond — il sera automatiquement ramené au
                  maximum autorisé à l&apos;enregistrement.
                </p>
              )}
            </div>
          )}

          {/* Barème (lecture seule) + simulateur — repliés par défaut, info
              secondaire que la plupart des commerçants ne consultent qu'une fois. */}
          <details className="bg-surface-2 border-border rounded-[12px] border p-4">
            <summary className="flex cursor-pointer items-center gap-2 select-none">
              <Truck className="size-4" />
              <p className="text-sm font-semibold">
                Barème plateforme & simulateur de prix
              </p>
            </summary>
            <div className="mt-3 space-y-3">
              <dl className="text-muted grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt>Base</dt>
                <dd className="text-right tabular-nums">
                  {formatDA(pricing.delivery_base_da)}
                </dd>
                <dt>
                  Au km au-delà de {pricing.delivery_free_km_threshold} km
                </dt>
                <dd className="text-right tabular-nums">
                  {formatDA(pricing.delivery_per_km_da)}
                </dd>
                <dt>Plancher / Plafond</dt>
                <dd className="text-right tabular-nums">
                  {formatDA(pricing.delivery_min_da)} —{" "}
                  {formatDA(pricing.delivery_max_da)}
                </dd>
              </dl>

              <div className="border-border space-y-2 border-t pt-3">
                <Label htmlFor="sim_km">Simulateur</Label>
                <div className="flex items-center gap-3">
                  <Input
                    id="sim_km"
                    type="number"
                    min={0}
                    step="0.5"
                    value={simKm}
                    onChange={(e) => setSimKm(Number(e.target.value) || 0)}
                    className="max-w-[120px]"
                  />
                  <span className="text-muted text-sm">km →</span>
                  <span className="text-base font-semibold tabular-nums">
                    {quote.outOfRange ? (
                      <span className="text-danger-600">Hors rayon</span>
                    ) : (
                      formatDA(quote.feeDa)
                    )}
                  </span>
                </div>
                {!quote.outOfRange && quote.breakdown.clamped && (
                  <p className="text-subtle text-xs">
                    {quote.breakdown.clamped === "min"
                      ? "Plancher appliqué."
                      : "Plafond appliqué."}
                  </p>
                )}
              </div>
            </div>
          </details>
        </>
      )}

      {state.error && btnState === "error" && (
        <p className="text-danger-600 text-sm">{state.error}</p>
      )}

      <ActionButton
        type="submit"
        state={btnState}
        disabled={positionMissing}
        labels={{
          idle: positionMissing ? "Position requise" : "Enregistrer",
          pending: "Enregistrement…",
          success: "Livraison enregistrée ✓",
          error: "Erreur, réessaie",
        }}
      />
    </form>
  );
}

/**
 * Switch contrôlé : on synchronise l'état React avec une checkbox CACHÉE
 * (vraiment cochée/décochée) pour que FormData récupère `name=on` côté action.
 * Le visuel est rendu par un `button role="switch"` séparé.
 */
function Switch({
  name,
  label,
  description,
  icon,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {label}
        </span>
        {description && (
          <span className="text-muted mt-0.5 block text-xs">{description}</span>
        )}
      </span>
      {/* checkbox visuellement cachée mais bien dans le DOM pour FormData */}
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-primary-600" : "bg-surface-3"
        )}
      >
        <span
          className={cn(
            "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-0.5"
          )}
        />
      </span>
    </label>
  );
}
