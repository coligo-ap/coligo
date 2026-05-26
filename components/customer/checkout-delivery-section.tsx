"use client";

import Link from "next/link";
import { Bolt, Calendar, MapPin, Truck } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import type { CheckoutDeliveryContext } from "@/app/(customer)/checkout/context";

export type DeliveryChoice = {
  /** "pickup" = retrait sur place ; "delivery" = livraison. */
  fulfillment: "pickup" | "delivery";
  /** Adresse choisie (requise si fulfillment=delivery). */
  addressId: string | null;
  /** Mode (requis si fulfillment=delivery). */
  mode: "express" | "tour" | null;
  /** Slot (requis si mode=tour). */
  slotId: string | null;
  /** Téléphone alternatif (optionnel). */
  phoneOverride: string;
};

export function CheckoutDeliverySection({
  delivery,
  value,
  onChange,
}: {
  delivery: CheckoutDeliveryContext;
  value: DeliveryChoice;
  onChange: (next: DeliveryChoice) => void;
}) {
  const update = (patch: Partial<DeliveryChoice>) =>
    onChange({ ...value, ...patch });

  // Si la livraison n'est pas dispo (commerçant n'a pas activé), on cache
  // tout — pas même un toggle qui amènerait à rien.
  if (!delivery.enabled) return null;

  const selectedAddress = delivery.addresses.find(
    (a) => a.id === value.addressId
  );

  return (
    <section className="space-y-3">
      {/* Toggle Retrait / Livraison */}
      <div className="border-border bg-surface flex gap-2 overflow-hidden rounded-[12px] border p-1">
        <Tab
          icon={<MapPin className="size-4" />}
          label="Retrait"
          active={value.fulfillment === "pickup"}
          onClick={() =>
            update({
              fulfillment: "pickup",
              addressId: null,
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
        <div className="border-border bg-surface space-y-4 rounded-[14px] border p-4">
          {/* Adresses */}
          <div className="space-y-2">
            <p className="text-sm font-semibold">Adresse de livraison</p>
            {delivery.addresses.length === 0 ? (
              <Link
                href="/adresses"
                className="border-primary-300 bg-primary-50 text-primary-700 block rounded-[10px] border-2 border-dashed px-3 py-2 text-center text-sm"
              >
                + Ajouter une adresse sur la carte
              </Link>
            ) : (
              <ul className="space-y-2">
                {delivery.addresses.map((a) => {
                  const disabled = a.out_of_range;
                  const isSel = value.addressId === a.id;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => update({ addressId: a.id })}
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
                          <p className="truncate text-sm font-medium">
                            {a.label}
                          </p>
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
                      </button>
                    </li>
                  );
                })}
                <li>
                  <Link
                    href="/adresses"
                    className="text-primary-700 inline-block text-xs underline"
                  >
                    + Ajouter une adresse
                  </Link>
                </li>
              </ul>
            )}
          </div>

          {/* Modes (Express vs Tournée) */}
          {selectedAddress && !selectedAddress.out_of_range && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Mode</p>
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
              {!delivery.express_enabled && !delivery.tours_enabled && (
                <p className="text-warning-700 text-xs">
                  Aucun mode de livraison disponible pour ce commerçant.
                </p>
              )}
            </div>
          )}

          {/* Sélecteur de créneau (tour) */}
          {value.mode === "tour" &&
            selectedAddress &&
            !selectedAddress.out_of_range && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">Créneau</p>
                {delivery.slots.length === 0 ? (
                  <p className="text-muted text-xs">
                    Aucun créneau ouvert pour l&apos;instant — repasse plus tard
                    ou choisis Express.
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

          {/* Téléphone alternatif */}
          {selectedAddress && !selectedAddress.out_of_range && (
            <div className="space-y-1.5">
              <label htmlFor="phone_override" className="text-sm font-semibold">
                Téléphone livraison (optionnel)
              </label>
              <input
                id="phone_override"
                type="tel"
                value={value.phoneOverride}
                onChange={(e) => update({ phoneOverride: e.target.value })}
                placeholder={
                  selectedAddress.phone_override ?? "Si différent du compte"
                }
                className="border-border bg-surface block w-full rounded-[10px] border px-3 py-2 text-sm"
              />
            </div>
          )}
        </div>
      )}
    </section>
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
        "flex flex-1 items-center justify-center gap-2 rounded-[10px] py-2 text-sm font-semibold transition",
        active ? "bg-primary-600 text-white shadow" : "text-muted"
      )}
    >
      {icon}
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
