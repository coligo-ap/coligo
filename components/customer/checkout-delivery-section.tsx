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
  Truck,
  UserPlus,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { MapPositionPicker } from "@/components/shared/map-position-picker";
import { ZoneNotice } from "@/components/zones/zone-notice";
import {
  computeDeliveryFee,
  computeTourDeliveryFee,
} from "@/lib/delivery/pricing";
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

  // « Modifier » rouvre la grande carte après repliement (position confirmée).
  const [editing, setEditing] = useState(false);

  const selectedSavedAddress = delivery.addresses.find(
    (a) => a.id === value.addressId
  );

  const customQuote = useMemo(() => {
    if (!value.customPosition || !merchantPosition || !pricing) return null;
    const distKm = haversineKm(
      { lat: merchantPosition.lat, lng: merchantPosition.lng },
      value.customPosition
    );
    // En tournée, on applique le tarif marchand par bande (cohérent avec le
    // prix que le commerçant a fixé) ; sinon barème express.
    if (value.mode === "tour") {
      return computeTourDeliveryFee(
        distKm,
        delivery.tour_bands,
        pricing,
        merchantPosition.radiusKm
      );
    }
    return computeDeliveryFee(distKm, pricing, merchantPosition.radiusKm);
  }, [
    value.customPosition,
    value.mode,
    merchantPosition,
    pricing,
    delivery.tour_bands,
  ]);

  if (!delivery.enabled) {
    // Livraison désactivée chez ce commerçant → uniquement le retrait, pas de
    // toggle (le créneau de retrait est rendu par le parent).
    return null;
  }

  const isDelivery = value.fulfillment === "delivery";
  const ready = hasValidPosition(value, selectedSavedAddress);
  const collapsed = isDelivery && ready && !editing;

  // Résumé de la position retenue (ligne repliée + statut « dans la zone »).
  const inZoneFee =
    selectedSavedAddress && !selectedSavedAddress.out_of_range
      ? value.mode === "tour"
        ? (selectedSavedAddress.tour_fee_da ?? selectedSavedAddress.fee_da ?? 0)
        : (selectedSavedAddress.fee_da ?? 0)
      : customQuote && !customQuote.outOfRange
        ? customQuote.feeDa
        : null;
  const summaryLabel =
    selectedSavedAddress && !selectedSavedAddress.out_of_range
      ? selectedSavedAddress.label
      : (value.customAddressText ?? null);

  return (
    <section className="mt-3 space-y-3" data-checkout>
      {/* Toggle Retrait / Livraison — pilule blanche qui GLISSE. */}
      <div className="bg-surface-2 relative flex rounded-[15px] p-[5px]">
        <span
          aria-hidden
          className={cn(
            "bg-surface absolute top-[5px] bottom-[5px] w-[calc(50%-5px)] rounded-[11px] shadow-[0_3px_10px_-2px_rgba(40,35,90,0.18)] transition-transform duration-300 ease-[cubic-bezier(.34,1.4,.64,1)]",
            isDelivery
              ? "translate-x-full rtl:-translate-x-full"
              : "translate-x-0"
          )}
        />
        <ModeTab
          icon={<MapPin className="size-4" />}
          label={t("pickup")}
          active={!isDelivery}
          onClick={() => {
            setEditing(false);
            update({
              fulfillment: "pickup",
              addressId: null,
              customPosition: null,
              positionConfirmed: false,
              mode: null,
              slotId: null,
            });
          }}
        />
        <ModeTab
          icon={<Truck className="size-4" />}
          label={t("delivery")}
          active={isDelivery}
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

      {isDelivery && (
        <>
          {collapsed ? (
            /* ── Position confirmée → ligne compacte premium + « Modifier ». ── */
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="border-border bg-surface co-rise flex w-full items-center gap-3 rounded-[20px] border p-3.5 text-start shadow-[0_1px_2px_rgba(20,20,50,0.04),0_6px_20px_-10px_rgba(40,35,90,0.16)]"
            >
              <span className="from-primary-100 relative grid size-[50px] shrink-0 place-items-center overflow-hidden rounded-[13px] bg-gradient-to-br to-[#dfdfea]">
                <MapPin
                  className="text-primary-600 size-5"
                  fill="currentColor"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground flex items-center gap-1.5 text-[14px] font-extrabold">
                  <Check className="text-success-600 size-4 shrink-0" />
                  {t("positionConfirmed")}
                </span>
                <span className="text-muted mt-0.5 block truncate text-[12px] font-semibold">
                  {[
                    summaryLabel,
                    t("inZone"),
                    inZoneFee != null ? formatDA(inZoneFee) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="text-primary-700 shrink-0 text-[13px] font-extrabold">
                {t("edit")}
              </span>
            </button>
          ) : (
            /* ── Grande carte de sélection (hero). ── */
            <div className="bg-surface co-rise overflow-hidden rounded-[20px] shadow-[0_1px_2px_rgba(20,20,50,0.04),0_6px_20px_-10px_rgba(40,35,90,0.16)]">
              {/* Adresses enregistrées = raccourcis (chips). */}
              {delivery.addresses.length > 0 && (
                <div className="scrollbar-hide flex gap-2 overflow-x-auto p-3 pb-0">
                  {delivery.addresses.map((a) => {
                    const isSel = value.addressId === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        disabled={a.out_of_range}
                        onClick={() => {
                          setEditing(false);
                          update({
                            addressId: a.id,
                            customPosition: null,
                            customAddressText: null,
                            positionConfirmed: false,
                          });
                        }}
                        className={cn(
                          "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-bold transition",
                          a.out_of_range
                            ? "border-border text-subtle cursor-not-allowed opacity-60"
                            : isSel
                              ? "border-primary-500 bg-primary-50 text-primary-700"
                              : "border-border bg-surface text-foreground hover:border-primary-300"
                        )}
                      >
                        <MapPin className="size-3.5" />
                        {a.label}
                        {a.out_of_range && (
                          <span className="text-danger-600 text-[11px]">
                            · {t("outOfZone")}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <DeliveryMapCard
                value={value}
                update={update}
                customQuote={customQuote}
                defaultPosition={defaultPosition}
                onConfirmed={() => setEditing(false)}
              />
            </div>
          )}

          {selectedSavedAddress?.out_of_range && (
            <p className="border-danger-200 bg-danger-50 text-danger-700 flex items-start gap-2 rounded-[12px] border px-3 py-2 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {t("outOfDeliveryZone")}
              {merchantPosition
                ? ` (${t("maxRadius", { km: merchantPosition.radiusKm.toFixed(1) })})`
                : ""}
              {t("chooseOtherAddressOrPickup")}
            </p>
          )}

          {/* Mode + créneau + destinataire — révélés une fois la position prête. */}
          {ready && (
            <div className="border-border bg-surface space-y-4 rounded-[20px] border p-4 shadow-[0_1px_2px_rgba(20,20,50,0.04),0_6px_20px_-10px_rgba(40,35,90,0.16)]">
              {(delivery.express_enabled || delivery.tours_enabled) && (
                <div className="space-y-2">
                  <p className="text-muted text-[11px] font-extrabold tracking-wider uppercase">
                    {t("mode")}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {delivery.express_enabled && (
                      <ModeButton
                        icon={<Bolt className="size-4" />}
                        label={t("express")}
                        sub={t("expressSub")}
                        active={value.mode === "express"}
                        onClick={() =>
                          update({ mode: "express", slotId: null })
                        }
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
              )}

              {value.mode === "tour" && (
                <div className="space-y-2">
                  <p className="text-muted text-[11px] font-extrabold tracking-wider uppercase">
                    {t("slot")}
                  </p>
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
                                "flex w-full items-center gap-3 rounded-[12px] border px-3 py-2.5 text-start text-sm transition",
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
                                  : t("slotAvailable", { count: s.available })}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              <RecipientBlock value={value} update={update} />
            </div>
          )}
        </>
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

/**
 * Grande carte de sélection : map MapLibre plein largeur + statut zone en UNE
 * ligne (3 états) + case « Je confirme cette position ». Le marqueur change de
 * couleur selon l'état (violet OK / rouge hors-zone).
 */
function DeliveryMapCard({
  value,
  update,
  customQuote,
  defaultPosition,
  onConfirmed,
}: {
  value: DeliveryChoice;
  update: (patch: Partial<DeliveryChoice>) => void;
  customQuote: ReturnType<typeof computeDeliveryFee> | null;
  defaultPosition?: { lat: number; lng: number } | null;
  onConfirmed: () => void;
}) {
  const t = useTranslations("checkout");
  const outOfRange = customQuote?.outOfRange ?? false;
  const hasPoint = value.customPosition != null;

  // Adresse lisible du point pointé (reverse-geocode, debounce 800 ms).
  const [addr, setAddr] = useState<string | null>(value.customAddressText);
  const [addrLoading, setAddrLoading] = useState(false);
  const lat = value.customPosition?.lat ?? null;
  const lng = value.customPosition?.lng ?? null;
  useEffect(() => {
    if (lat == null || lng == null) {
      setAddr(null);
      return;
    }
    setAddrLoading(true);
    const timer = setTimeout(async () => {
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
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  // Couleur du marqueur : rouge hors zone, sinon violet.
  const markerColorClass = outOfRange ? "text-danger-600" : "text-primary-700";

  return (
    <div>
      <MapPositionPicker
        initial={value.customPosition ?? undefined}
        defaultCenter={defaultPosition ?? undefined}
        autoLocate={value.customPosition == null}
        height={208}
        searchEnabled
        searchPlaceholder={t("searchAddressPlaceholder")}
        pulse
        markerColorClass={markerColorClass}
        gpsLabel={t("myPosition")}
        onChange={(p) =>
          update({
            customPosition: p,
            addressId: null,
            positionConfirmed: false,
          })
        }
        onConfirm={(p) => {
          update({
            customPosition: p,
            addressId: null,
            positionConfirmed: true,
          });
          onConfirmed();
        }}
      />

      {/* Couverture du service de livraison sur ce point (moteur de zones,
          temps réel) — complète le contrôle de distance ci-dessous. */}
      {hasPoint && !outOfRange && (
        <ZoneNotice
          lat={lat ?? null}
          lng={lng ?? null}
          services={value.mode ? [value.mode] : ["express", "tour"]}
          role="destination"
          className="mx-4 mt-1"
        />
      )}

      {/* Statut zone — UNE ligne, 3 états. */}
      {!hasPoint ? (
        <div className="flex items-center gap-2.5 px-4 py-3.5 text-[13px] font-bold text-amber-600">
          <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-amber-50 text-amber-600">
            <MapPin className="size-4" />
          </span>
          <span>{t("pinYourPosition")}</span>
        </div>
      ) : outOfRange ? (
        <div className="text-danger-700 flex items-center gap-2.5 px-4 py-3.5 text-[13px] font-bold">
          <span className="bg-danger-50 text-danger-600 grid size-[30px] shrink-0 place-items-center rounded-[9px]">
            <AlertTriangle className="size-4" />
          </span>
          <span>
            {t("outOfZoneFull", {
              km:
                customQuote?.outOfRange === true && customQuote.maxRadiusKm
                  ? customQuote.maxRadiusKm.toFixed(0)
                  : "",
            })}
          </span>
        </div>
      ) : (
        <div className="text-success-700 flex items-center gap-2.5 px-4 py-3.5 text-[13.5px] font-bold">
          <span className="bg-success-50 text-success-600 grid size-[30px] shrink-0 place-items-center rounded-[9px]">
            <Check className="size-4" />
          </span>
          <span className="min-w-0 flex-1 truncate">
            {addrLoading ? (
              <span className="text-muted font-semibold">{t("searching")}</span>
            ) : (
              <>
                <span className="text-foreground font-extrabold">
                  {addr ??
                    (value.customPosition
                      ? `${value.customPosition.lat.toFixed(4)}, ${value.customPosition.lng.toFixed(4)}`
                      : "")}
                </span>{" "}
                · {t("inZone")}
              </>
            )}
          </span>
          {customQuote && !customQuote.outOfRange && (
            <span className="bg-surface-2 text-foreground ms-auto shrink-0 rounded-[9px] px-2.5 py-1 text-[13px] font-extrabold tabular-nums">
              {formatDA(customQuote.feeDa)}
            </span>
          )}
        </div>
      )}

      {/* Confirmation explicite — case « Je confirme cette position ». Reste
          accessible même après confirmation (réouverture via « Modifier »)
          pour offrir un retour vers la vue repliée. */}
      {hasPoint && !outOfRange && (
        <button
          type="button"
          onClick={() => {
            update({ positionConfirmed: true });
            onConfirmed();
          }}
          className="from-primary-50 mx-4 mb-4 flex w-[calc(100%-2rem)] items-center gap-3 rounded-[13px] bg-gradient-to-r to-[#f4f2ff] p-3.5 text-start active:scale-[0.99]"
        >
          <span
            className={cn(
              "text-background grid size-6 shrink-0 place-items-center rounded-[8px] shadow-[0_3px_8px_-2px_rgba(91,91,230,0.4)] transition",
              value.positionConfirmed
                ? "from-primary-400 to-primary-700 bg-gradient-to-br"
                : "border-primary-400 border-2 bg-white"
            )}
          >
            {value.positionConfirmed && <Check className="size-4" />}
          </span>
          <span className="text-muted text-[12.5px] font-semibold">
            <span className="text-foreground font-extrabold">
              {t("confirmThisPosition")}.
            </span>{" "}
            {t("driverGoesThere")}
          </span>
        </button>
      )}

      {/* Enregistrer la position confirmée dans le profil. */}
      {hasPoint && !outOfRange && value.positionConfirmed && (
        <div className="px-4 pb-4">
          <SaveAddressInline
            lat={value.customPosition!.lat}
            lng={value.customPosition!.lng}
            addressText={addr}
          />
        </div>
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
          "flex w-full items-center gap-3 rounded-[12px] border p-3 text-start transition",
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

/** Onglet du toggle Retrait/Livraison (au-dessus de la pilule glissante). */
function ModeTab({
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
        "relative z-[2] flex flex-1 items-center justify-center gap-2 rounded-[11px] py-3 text-sm font-extrabold transition active:scale-[0.98]",
        active ? "text-foreground" : "text-muted"
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
        "flex items-start gap-2 rounded-[12px] border p-3 text-start transition active:scale-[0.98]",
        active
          ? "border-primary-500 bg-primary-50"
          : "border-border bg-surface hover:border-primary-300"
      )}
    >
      <span
        className={cn("mt-0.5", active ? "text-primary-600" : "text-muted")}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="text-muted text-xs">{sub}</span>
      </span>
    </button>
  );
}
