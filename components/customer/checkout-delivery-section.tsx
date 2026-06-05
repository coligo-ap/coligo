"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bolt,
  Calendar,
  Check,
  MapPin,
  Maximize2,
  Truck,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { MapPositionPicker } from "@/components/shared/map-position-picker";
import { computeDeliveryFee } from "@/lib/delivery/pricing";
import { haversineKm } from "@/lib/delivery/distance";
import { reverseGeocode } from "@/app/(customer)/actions";
import type {
  CheckoutDeliveryContext,
  CheckoutMerchantPosition,
} from "@/app/(customer)/checkout/context";

export type DeliveryChoice = {
  /** "pickup" = retrait sur place ; "delivery" = livraison. */
  fulfillment: "pickup" | "delivery";
  /** Adresse enregistrée choisie (si custom = null + customPosition rempli). */
  addressId: string | null;
  /** Position custom posée à la volée sur la carte (alternative à addressId). */
  customPosition: { lat: number; lng: number } | null;
  /** Adresse lisible résolue (reverse-geocode) du point custom — pour le livreur. */
  customAddressText: string | null;
  /** True quand le client a explicitement confirmé sa position custom. */
  positionConfirmed: boolean;
  /** Mode (requis si fulfillment=delivery). */
  mode: "express" | "tour" | null;
  /** Slot (requis si mode=tour). */
  slotId: string | null;
  /** Téléphone alternatif (optionnel). */
  phoneOverride: string;
  /** Note livraison (commentaire client → livreur). */
  deliveryNote: string;
};

export function CheckoutDeliverySection({
  delivery,
  merchantPosition,
  pricing,
  value,
  onChange,
  defaultPosition,
}: {
  delivery: CheckoutDeliveryContext;
  merchantPosition: CheckoutMerchantPosition | null;
  pricing: {
    delivery_base_da: number;
    delivery_per_km_da: number;
    delivery_free_km_threshold: number;
    delivery_min_da: number;
    delivery_max_da: number;
    delivery_max_radius_km: number;
  } | null;
  value: DeliveryChoice;
  onChange: (next: DeliveryChoice) => void;
  /** Position exacte par défaut du client (centre initial de la carte). */
  defaultPosition?: { lat: number; lng: number } | null;
}) {
  const update = (patch: Partial<DeliveryChoice>) =>
    onChange({ ...value, ...patch });

  const selectedSavedAddress = delivery.addresses.find(
    (a) => a.id === value.addressId
  );

  // Calcul de la quote pour une position custom (live, côté client).
  // useMemo DOIT être appelé avant tout early-return pour respecter la
  // règle des hooks.
  const customQuote = useMemo(() => {
    if (!value.customPosition || !merchantPosition || !pricing) return null;
    const distKm = haversineKm(
      { lat: merchantPosition.lat, lng: merchantPosition.lng },
      value.customPosition
    );
    return computeDeliveryFee(distKm, pricing, merchantPosition.radiusKm);
  }, [value.customPosition, merchantPosition, pricing]);

  if (!delivery.enabled) return null;

  // Le client doit avoir une position EXACTE et CONFIRMÉE avant de pouvoir
  // submit. Si position custom, le bouton "Confirmer" la valide. Si adresse
  // enregistrée, on considère la confirmation implicite (on a déjà sa lat/lng).

  return (
    <section className="space-y-3">
      {/* Toggle Retrait / Livraison (style Uber : fond gris, actif blanc) */}
      <div className="bg-surface-2 flex gap-1.5 rounded-[14px] p-1.5">
        <Tab
          icon={<MapPin className="size-4" />}
          label="Retrait"
          active={value.fulfillment === "pickup"}
          onClick={() =>
            update({
              fulfillment: "pickup",
              addressId: null,
              customPosition: null,
              positionConfirmed: false,
              mode: null,
              slotId: null,
            })
          }
        />
        <Tab
          icon={<Truck className="size-4" />}
          label="Livraison"
          active={value.fulfillment === "delivery"}
          onClick={() =>
            update({
              fulfillment: "delivery",
              mode: delivery.express_enabled
                ? "express"
                : delivery.tours_enabled
                  ? "tour"
                  : null,
            })
          }
        />
      </div>

      {value.fulfillment === "delivery" && (
        <div className="border-border bg-surface space-y-4 rounded-[16px] border p-4 shadow-sm">
          <DeliveryAddressBlock
            delivery={delivery}
            value={value}
            update={update}
            customQuote={customQuote}
            selectedSavedAddress={selectedSavedAddress}
            merchantPosition={merchantPosition}
            defaultPosition={defaultPosition}
          />

          {/* Modes Express / Tournée (uniquement si position valide) */}
          {hasValidPosition(value, selectedSavedAddress) && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Mode de livraison</p>
              <div className="grid grid-cols-2 gap-2">
                {delivery.express_enabled && (
                  <ModeButton
                    icon={<Bolt className="size-4" />}
                    label="Express"
                    sub="Dès qu'un livreur est dispo"
                    active={value.mode === "express"}
                    onClick={() => update({ mode: "express", slotId: null })}
                  />
                )}
                {delivery.tours_enabled && (
                  <ModeButton
                    icon={<Calendar className="size-4" />}
                    label="Tournée"
                    sub="Choisis un créneau"
                    active={value.mode === "tour"}
                    onClick={() => update({ mode: "tour" })}
                  />
                )}
              </div>
            </div>
          )}

          {/* Sélecteur de créneau (tour) */}
          {hasValidPosition(value, selectedSavedAddress) &&
            value.mode === "tour" && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">Créneau</p>
                {delivery.slots.length === 0 ? (
                  <p className="text-muted text-xs">
                    Aucun créneau ouvert. Choisis Express ou repasse plus tard.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {delivery.slots.map((s) => {
                      const full = s.available === 0;
                      const isSel = value.slotId === s.id;
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            disabled={full}
                            onClick={() => update({ slotId: s.id })}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-[10px] border px-3 py-2 text-left text-sm",
                              full
                                ? "border-border bg-surface-2 text-muted cursor-not-allowed opacity-60"
                                : isSel
                                  ? "border-primary-500 bg-primary-50"
                                  : "border-border bg-surface hover:border-primary-300"
                            )}
                          >
                            <Calendar className="size-4 shrink-0" />
                            <span className="flex-1 tabular-nums">
                              {new Date(s.slot_date).toLocaleDateString(
                                "fr-FR",
                                {
                                  weekday: "short",
                                  day: "2-digit",
                                  month: "short",
                                }
                              )}{" "}
                              · {s.start_time.slice(0, 5)}–
                              {s.end_time.slice(0, 5)}
                            </span>
                            <span className="text-muted text-xs tabular-nums">
                              {full
                                ? "Complet"
                                : `${s.available} place${s.available > 1 ? "s" : ""}`}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

          {/* Tél alternatif + note livraison */}
          {hasValidPosition(value, selectedSavedAddress) && (
            <>
              <div className="space-y-1.5">
                <Label
                  htmlFor="phone_override"
                  className="text-sm font-semibold"
                >
                  Téléphone livraison (optionnel)
                </Label>
                <Input
                  id="phone_override"
                  type="tel"
                  value={value.phoneOverride}
                  onChange={(e) => update({ phoneOverride: e.target.value })}
                  placeholder={
                    selectedSavedAddress?.phone_override ??
                    "Si différent du compte"
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="delivery_note"
                  className="text-sm font-semibold"
                >
                  Note pour le livreur (optionnel)
                </Label>
                <textarea
                  id="delivery_note"
                  value={value.deliveryNote}
                  onChange={(e) => update({ deliveryNote: e.target.value })}
                  placeholder="Ex: Sonner 2 fois, bâtiment B, 3e étage, code porte 1234…"
                  className="border-border bg-surface min-h-[64px] w-full rounded-[10px] border px-3 py-2 text-sm"
                  maxLength={300}
                />
                <p className="text-subtle text-xs">
                  Vu par le livreur ET le commerçant.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** True si on a un point de livraison utilisable (adresse OK ou custom confirmée). */
function hasValidPosition(
  v: DeliveryChoice,
  saved: CheckoutDeliveryContext["addresses"][number] | undefined
): boolean {
  if (saved && !saved.out_of_range) return true;
  if (v.customPosition && v.positionConfirmed) return true;
  return false;
}

function DeliveryAddressBlock({
  delivery,
  value,
  update,
  customQuote,
  selectedSavedAddress,
  merchantPosition,
  defaultPosition,
}: {
  delivery: CheckoutDeliveryContext;
  value: DeliveryChoice;
  update: (patch: Partial<DeliveryChoice>) => void;
  customQuote: ReturnType<typeof computeDeliveryFee> | null;
  selectedSavedAddress?: CheckoutDeliveryContext["addresses"][number];
  merchantPosition: CheckoutMerchantPosition | null;
  defaultPosition?: { lat: number; lng: number } | null;
}) {
  // La carte est ouverte PAR DÉFAUT : le client doit voir tout de suite sa
  // position actuelle pour la livraison (exigence métier). Ses adresses
  // enregistrées restent listées au-dessus et il peut basculer dessus d'un
  // clic. On ne referme la carte que s'il choisit une adresse enregistrée.
  const [pickerOpen, setPickerOpen] = useState(true);

  // Quand le client choisit une adresse enregistrée, on remet à zéro le
  // picker custom.
  useEffect(() => {
    if (value.addressId) setPickerOpen(false);
  }, [value.addressId]);

  return (
    <div className="space-y-3">
      <p className="text-muted flex items-center gap-2 text-[12px] font-bold tracking-wide uppercase">
        <MapPin className="text-foreground size-[15px]" />
        Où livrer ?
      </p>

      {/* Adresses enregistrées (cards cliquables) */}
      {delivery.addresses.length > 0 && (
        <ul className="space-y-2">
          {delivery.addresses.map((a) => {
            const disabled = a.out_of_range;
            const isSel = value.addressId === a.id;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    update({
                      addressId: a.id,
                      customPosition: null,
                      positionConfirmed: false,
                    });
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-[10px] border p-3 text-left",
                    disabled
                      ? "border-border bg-surface-2 text-muted cursor-not-allowed opacity-60"
                      : isSel
                        ? "border-primary-500 bg-primary-50"
                        : "border-border bg-surface hover:border-primary-300"
                  )}
                >
                  <MapPin className="mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.label}</p>
                    {a.address_text && (
                      <p className="text-muted mt-0.5 truncate text-xs">
                        {a.address_text}
                      </p>
                    )}
                    <p className="text-subtle mt-0.5 text-xs tabular-nums">
                      {a.out_of_range
                        ? `Hors zone (${a.distance_km > 0 ? a.distance_km.toFixed(1) + " km" : "—"})`
                        : `${a.distance_km.toFixed(1)} km · ${formatDA(a.fee_da ?? 0)}`}
                    </p>
                  </div>
                  {isSel && (
                    <Check className="text-primary-700 mt-0.5 size-4" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Bascule "Nouvelle position" */}
      {!pickerOpen ? (
        <button
          type="button"
          onClick={() => {
            update({ addressId: null, positionConfirmed: false });
            setPickerOpen(true);
          }}
          className="border-primary-300 bg-primary-50 text-primary-700 hover:bg-primary-100 w-full rounded-[10px] border-2 border-dashed px-3 py-2 text-center text-sm font-semibold"
        >
          + Indiquer une autre position sur la carte
        </button>
      ) : (
        <CustomPositionPicker
          value={value}
          update={update}
          customQuote={customQuote}
          merchantPosition={merchantPosition}
          defaultPosition={defaultPosition}
          canSwitchToSaved={delivery.addresses.length > 0}
          onSwitchToSaved={() => {
            update({
              customPosition: null,
              positionConfirmed: false,
              addressId: delivery.addresses[0]?.id ?? null,
            });
            setPickerOpen(false);
          }}
        />
      )}

      {/* Avertissement adresse enregistrée hors zone */}
      {selectedSavedAddress?.out_of_range && (
        <p className="border-danger-200 bg-danger-50 text-danger-700 flex items-start gap-2 rounded-[10px] border px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Cette adresse dépasse le rayon de livraison du commerçant
          {merchantPosition
            ? ` (${merchantPosition.radiusKm.toFixed(1)} km max)`
            : ""}
          . Choisis une autre adresse, indique une position plus proche, ou
          prends en retrait sur place.
        </p>
      )}
    </div>
  );
}

function CustomPositionPicker({
  value,
  update,
  customQuote,
  merchantPosition,
  defaultPosition,
  canSwitchToSaved,
  onSwitchToSaved,
}: {
  value: DeliveryChoice;
  update: (patch: Partial<DeliveryChoice>) => void;
  customQuote: ReturnType<typeof computeDeliveryFee> | null;
  merchantPosition: CheckoutMerchantPosition | null;
  defaultPosition?: { lat: number; lng: number } | null;
  canSwitchToSaved: boolean;
  onSwitchToSaved: () => void;
}) {
  const outOfRange = customQuote?.outOfRange ?? false;

  // Adresse lisible du point pointé (reverse-geocode), réactualisée à chaque
  // déplacement du curseur (debounce 800 ms pour ménager l'API). On la stocke
  // aussi dans le choix pour que le livreur ait une adresse, pas que des
  // coordonnées.
  const [addr, setAddr] = useState<string | null>(null);
  const [addrLoading, setAddrLoading] = useState(false);
  const lat = value.customPosition?.lat ?? null;
  const lng = value.customPosition?.lng ?? null;
  useEffect(() => {
    if (lat == null || lng == null) {
      setAddr(null);
      return;
    }
    setAddrLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await reverseGeocode({ latitude: lat, longitude: lng });
        const label = res.ok
          ? (res.display ??
            [res.commune, res.wilaya_name].filter(Boolean).join(" · "))
          : null;
        setAddr(label || null);
        update({ customAddressText: label || null });
      } finally {
        setAddrLoading(false);
      }
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  return (
    <div className="border-primary-300 bg-primary-50/40 space-y-2 rounded-[12px] border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">Pointe ta position exacte</p>
        {canSwitchToSaved && (
          <button
            type="button"
            onClick={onSwitchToSaved}
            className="text-primary-700 text-xs underline"
          >
            ← Choisir une adresse enregistrée
          </button>
        )}
      </div>
      <p className="text-muted text-xs">
        Déplace la carte ou clique « Ma position » pour pointer exactement
        l&apos;endroit où tu veux être livré. Tu peux ensuite ajuster.
      </p>
      {/* Position de livraison :
          - si le client a déjà déplacé/choisi un point → on le garde (`initial`)
          - sinon la carte se centre sur sa position exacte enregistrée
            (`defaultCenter`) puis tente d'obtenir sa position GPS ACTUELLE
            (`autoLocate`) pour proposer par défaut là où il est vraiment.
          Il confirme ensuite via la case ci-dessous (obligatoire). */}
      <MapPositionPicker
        initial={value.customPosition ?? undefined}
        defaultCenter={defaultPosition ?? undefined}
        autoLocate={value.customPosition == null}
        height={160}
        onChange={(p) =>
          update({
            customPosition: p,
            addressId: null,
            positionConfirmed: false,
          })
        }
        gpsLabel="Ma position"
      />

      <p className="text-primary-600 mt-1 flex items-center justify-center gap-1 text-center text-[11px] font-bold">
        <Maximize2 className="size-3" />
        Touche « agrandir » pour ajuster précisément
      </p>

      {value.customPosition && (
        <>
          {/* Adresse résolue (mise à jour à chaque déplacement) + frais en
              chip à droite — façon maquette. Fallback sur les coordonnées. */}
          <div className="text-foreground flex items-center gap-2 text-[13.5px] font-bold">
            <MapPin className="text-primary-600 size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {addrLoading ? (
                <span className="text-muted font-medium">
                  Recherche de l&apos;adresse…
                </span>
              ) : addr ? (
                addr
              ) : (
                <span className="text-subtle tabular-nums">
                  {value.customPosition.lat.toFixed(5)},{" "}
                  {value.customPosition.lng.toFixed(5)}
                </span>
              )}
            </span>
            {customQuote && !customQuote.outOfRange && (
              <span className="bg-surface-2 ml-auto shrink-0 rounded-[8px] px-2.5 py-1 text-[13px] font-extrabold tabular-nums">
                {formatDA(customQuote.feeDa)}
              </span>
            )}
          </div>

          {outOfRange ? (
            <p className="border-danger-200 bg-danger-50 text-danger-700 flex items-start gap-2 rounded-[10px] border px-3 py-2 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Cette position est hors de la zone de livraison du commerçant
              {customQuote?.outOfRange === true && customQuote.maxRadiusKm
                ? ` (${customQuote.maxRadiusKm.toFixed(1)} km max)`
                : ""}
              . Rapproche le pointeur ou choisis « Retrait sur place ».
            </p>
          ) : (
            <>
              <p className="text-success-700 flex items-center gap-1.5 text-[12.5px] font-bold">
                <Check className="size-4" />
                Dans la zone de livraison
              </p>
              {/* Case « Je confirme » — encart violet façon maquette */}
              <label className="bg-primary-50 text-foreground flex cursor-pointer items-center gap-2.5 rounded-[11px] p-3 text-[12.5px]">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={value.positionConfirmed}
                  onChange={(e) =>
                    update({ positionConfirmed: e.target.checked })
                  }
                />
                <span
                  className={cn(
                    "grid size-[22px] shrink-0 place-items-center rounded-[7px] border-2 transition-colors",
                    value.positionConfirmed
                      ? "border-primary-600 bg-primary-600 text-white"
                      : "border-border-strong bg-white"
                  )}
                >
                  {value.positionConfirmed && <Check className="size-3.5" />}
                </span>
                <span>
                  <strong className="text-foreground font-extrabold">
                    Je confirme cette position.
                  </strong>{" "}
                  Le livreur s&apos;y rendra.
                </span>
              </label>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Tab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-[10px] py-3 text-sm font-extrabold transition",
        active ? "bg-surface text-foreground shadow-sm" : "text-muted"
      )}
    >
      <span className={active ? "text-primary-600" : ""}>{icon}</span>
      {label}
    </button>
  );
}

function ModeButton({
  icon,
  label,
  sub,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-2 rounded-[12px] border p-3 text-left transition",
        active
          ? "border-primary-500 bg-primary-50"
          : "border-border bg-surface hover:border-primary-300"
      )}
    >
      <span className="mt-0.5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="text-muted text-xs">{sub}</span>
      </span>
    </button>
  );
}
