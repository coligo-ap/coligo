"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Bolt,
  Calendar,
  Check,
  Loader2,
  MapPin,
  Maximize2,
  Truck,
  UserPlus,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { MapPositionPicker } from "@/components/shared/map-position-picker";
import { computeDeliveryFee } from "@/lib/delivery/pricing";
import { haversineKm } from "@/lib/delivery/distance";
import { reverseGeocode } from "@/app/(customer)/actions";
import { saveCustomerAddress } from "@/app/(customer)/adresses/actions";
import { toast } from "@/components/ui/toast";
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
  /** Téléphone de contact pour la livraison (destinataire). */
  phoneOverride: string;
  /** Nom du destinataire si on livre à quelqu'un d'autre. */
  recipientName: string;
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
  defaultPosition?: { lat: number; lng: number } | null;
}) {
  const t = useTranslations("checkout");
  const update = (patch: Partial<DeliveryChoice>) =>
    onChange({ ...value, ...patch });

  const selectedSavedAddress = delivery.addresses.find(
    (a) => a.id === value.addressId
  );

  const customQuote = useMemo(() => {
    if (!value.customPosition || !merchantPosition || !pricing) return null;
    const distKm = haversineKm(
      { lat: merchantPosition.lat, lng: merchantPosition.lng },
      value.customPosition
    );
    return computeDeliveryFee(distKm, pricing, merchantPosition.radiusKm);
  }, [value.customPosition, merchantPosition, pricing]);

  if (!delivery.enabled) return null;

  const ready = hasValidPosition(value, selectedSavedAddress);

  return (
    <section className="space-y-3">
      {/* Toggle Retrait / Livraison */}
      <div className="bg-surface-2 flex gap-1.5 rounded-[14px] p-1.5">
        <Tab
          icon={<MapPin className="size-4" />}
          label={t("pickup")}
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
          label={t("delivery")}
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

          {ready && (
            <>
              {/* Modes Express / Tournée */}
              <div className="space-y-2">
                <p className="text-sm font-semibold">{t("mode")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {delivery.express_enabled && (
                    <ModeButton
                      icon={<Bolt className="size-4" />}
                      label={t("express")}
                      sub={t("expressSub")}
                      active={value.mode === "express"}
                      onClick={() => update({ mode: "express", slotId: null })}
                    />
                  )}
                  {delivery.tours_enabled && (
                    <ModeButton
                      icon={<Calendar className="size-4" />}
                      label={t("tour")}
                      sub={t("tourSub")}
                      active={value.mode === "tour"}
                      onClick={() => update({ mode: "tour" })}
                    />
                  )}
                </div>
              </div>

              {/* Créneau (tour) */}
              {value.mode === "tour" && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">{t("slot")}</p>
                  {delivery.slots.length === 0 ? (
                    <p className="text-muted text-xs">
                      {t("noSlotPickExpress")}
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
                                  ? t("slotFull")
                                  : t("slotAvailable", {
                                      count: s.available,
                                    })}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              {/* Livrer à quelqu'un d'autre + note */}
              <RecipientBlock value={value} update={update} />
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
  const t = useTranslations("checkout");
  // Carte ouverte par défaut (= ma position actuelle). Se referme si le client
  // choisit une adresse enregistrée.
  const [pickerOpen, setPickerOpen] = useState(true);
  useEffect(() => {
    if (value.addressId) setPickerOpen(false);
  }, [value.addressId]);

  return (
    <div className="space-y-3">
      <p className="text-muted flex items-center gap-2 text-[12px] font-bold tracking-wide uppercase">
        <MapPin className="text-foreground size-[15px]" />
        {t("whereToDeliver")}
      </p>

      {/* Adresses enregistrées (raccourcis) */}
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
                  onClick={() =>
                    update({
                      addressId: a.id,
                      customPosition: null,
                      positionConfirmed: false,
                    })
                  }
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
                    <p className="text-subtle mt-0.5 text-xs tabular-nums">
                      {a.out_of_range
                        ? t("outOfZone")
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

      {/* Carte (position actuelle) OU bascule */}
      {!pickerOpen ? (
        <button
          type="button"
          onClick={() => {
            update({ addressId: null, positionConfirmed: false });
            setPickerOpen(true);
          }}
          className="border-primary-300 bg-primary-50 text-primary-700 hover:bg-primary-100 w-full rounded-[10px] border-2 border-dashed px-3 py-2 text-center text-sm font-semibold"
        >
          {t("otherPositionOnMap")}
        </button>
      ) : (
        <CustomPositionPicker
          value={value}
          update={update}
          customQuote={customQuote}
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

      {/* Adresse enregistrée hors zone */}
      {selectedSavedAddress?.out_of_range && (
        <p className="border-danger-200 bg-danger-50 text-danger-700 flex items-start gap-2 rounded-[10px] border px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {t("outOfDeliveryZone")}
          {merchantPosition
            ? ` (${t("maxRadius", { km: merchantPosition.radiusKm.toFixed(1) })})`
            : ""}
          {t("chooseOtherAddressOrPickup")}
        </p>
      )}
    </div>
  );
}

function CustomPositionPicker({
  value,
  update,
  customQuote,
  defaultPosition,
  canSwitchToSaved,
  onSwitchToSaved,
}: {
  value: DeliveryChoice;
  update: (patch: Partial<DeliveryChoice>) => void;
  customQuote: ReturnType<typeof computeDeliveryFee> | null;
  defaultPosition?: { lat: number; lng: number } | null;
  canSwitchToSaved: boolean;
  onSwitchToSaved: () => void;
}) {
  const t = useTranslations("checkout");
  const outOfRange = customQuote?.outOfRange ?? false;
  const [locateFailed, setLocateFailed] = useState(false);

  // Adresse lisible du point pointé (reverse-geocode, debounce 800 ms).
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
        <p className="text-sm font-semibold">{t("yourPosition")}</p>
        {canSwitchToSaved && (
          <button
            type="button"
            onClick={onSwitchToSaved}
            className="text-primary-700 text-xs underline"
          >
            {t("myAddresses")}
          </button>
        )}
      </div>

      <MapPositionPicker
        initial={value.customPosition ?? undefined}
        defaultCenter={defaultPosition ?? undefined}
        autoLocate={value.customPosition == null}
        height={180}
        searchEnabled
        gpsLabel={t("myPosition")}
        onLocate={(ok) => setLocateFailed(!ok)}
        onChange={(p) =>
          update({
            customPosition: p,
            addressId: null,
            positionConfirmed: false,
          })
        }
        onConfirm={(p) =>
          update({
            customPosition: p,
            addressId: null,
            positionConfirmed: true,
          })
        }
      />

      {locateFailed && !value.positionConfirmed && (
        <p className="border-warning-200 bg-warning-50 text-warning-800 flex items-start gap-2 rounded-[10px] border px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {t("positionNotDetected")}
        </p>
      )}

      {value.customPosition && (
        <>
          {/* Adresse résolue + frais */}
          <div className="text-foreground flex items-center gap-2 text-[13.5px] font-bold">
            <MapPin className="text-primary-600 size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {addrLoading ? (
                <span className="text-muted font-medium">{t("searching")}</span>
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
              {t("outOfZone")}
              {customQuote?.outOfRange === true && customQuote.maxRadiusKm
                ? ` (${t("maxRadius", { km: customQuote.maxRadiusKm.toFixed(1) })})`
                : ""}
              {t("movePointOrPickup")}
            </p>
          ) : value.positionConfirmed ? (
            <div className="space-y-2">
              <p className="text-success-700 flex items-center gap-1.5 text-[12.5px] font-bold">
                <Check className="size-4" />
                {t("positionConfirmed")}
              </p>
              <SaveAddressInline
                lat={value.customPosition.lat}
                lng={value.customPosition.lng}
                addressText={addr}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => update({ positionConfirmed: true })}
              className="bg-primary-600 hover:bg-primary-700 inline-flex w-full items-center justify-center gap-2 rounded-[12px] py-3 text-sm font-extrabold text-white"
            >
              <Check className="size-4" />
              {t("confirmThisPosition")}
            </button>
          )}

          {!value.positionConfirmed && !outOfRange && (
            <p className="text-primary-600 flex items-center justify-center gap-1 text-center text-[11px] font-bold">
              <Maximize2 className="size-3" />
              {t("enlargeToAdjust")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Enregistrer la position confirmée comme adresse du profil (label + save). */
function SaveAddressInline({
  lat,
  lng,
  addressText,
}: {
  lat: number;
  lng: number;
  addressText: string | null;
}) {
  const t = useTranslations("checkout");
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  if (saved) {
    return (
      <p className="text-success-700 flex items-center gap-1.5 text-[12px] font-semibold">
        <Check className="size-3.5" />
        {t("addressSavedToProfile")}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-primary-700 text-xs font-semibold underline"
      >
        {t("saveThisAddress")}
      </button>
    );
  }

  return (
    <div className="flex gap-2">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t("addressLabelPlaceholder")}
        className="h-10 flex-1"
        maxLength={60}
      />
      <button
        type="button"
        disabled={pending || label.trim() === ""}
        onClick={() =>
          start(async () => {
            const res = await saveCustomerAddress({
              label,
              lat,
              lng,
              address_text: addressText,
            });
            if (res.ok) setSaved(true);
            else toast.error(res.error ?? t("saveFailed"));
          })
        }
        className="bg-foreground text-background shrink-0 rounded-[10px] px-4 text-sm font-extrabold disabled:opacity-40"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : t("save")}
      </button>
    </div>
  );
}

/** Livrer à quelqu'un d'autre (nom + tél) + note livreur. */
function RecipientBlock({
  value,
  update,
}: {
  value: DeliveryChoice;
  update: (patch: Partial<DeliveryChoice>) => void;
}) {
  const t = useTranslations("checkout");
  const [forSomeoneElse, setForSomeoneElse] = useState(
    value.recipientName.trim() !== ""
  );

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => {
          const next = !forSomeoneElse;
          setForSomeoneElse(next);
          if (!next) update({ recipientName: "", phoneOverride: "" });
        }}
        className={cn(
          "flex w-full items-center gap-3 rounded-[12px] border p-3 text-left transition",
          forSomeoneElse
            ? "border-primary-500 bg-primary-50"
            : "border-border bg-surface hover:border-primary-300"
        )}
      >
        <UserPlus
          className={cn(
            "size-4 shrink-0",
            forSomeoneElse ? "text-primary-600" : "text-muted"
          )}
        />
        <span className="flex-1 text-sm font-semibold">
          {t("deliverToSomeoneElse")}
        </span>
        <span
          className={cn(
            "grid size-[22px] shrink-0 place-items-center rounded-[7px] border-2",
            forSomeoneElse
              ? "border-primary-600 bg-primary-600 text-white"
              : "border-border-strong bg-white"
          )}
        >
          {forSomeoneElse && <Check className="size-3.5" />}
        </span>
      </button>

      {forSomeoneElse && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={value.recipientName}
            onChange={(e) => update({ recipientName: e.target.value })}
            placeholder={t("recipientNamePlaceholder")}
            maxLength={80}
          />
          <Input
            type="tel"
            value={value.phoneOverride}
            onChange={(e) => update({ phoneOverride: e.target.value })}
            placeholder={t("recipientPhonePlaceholder")}
          />
        </div>
      )}

      <textarea
        value={value.deliveryNote}
        onChange={(e) => update({ deliveryNote: e.target.value })}
        placeholder={t("deliveryNotePlaceholder")}
        className="border-border bg-surface min-h-[52px] w-full rounded-[10px] border px-3 py-2 text-sm"
        maxLength={300}
      />
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
