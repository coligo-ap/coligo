"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Bolt,
  Bookmark,
  Calendar,
  Check,
  Loader2,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Truck,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import {
  computeDeliveryFee,
  computeTourDeliveryFee,
} from "@/lib/delivery/pricing";
import { haversineKm } from "@/lib/delivery/distance";
import { reverseGeocode, recordPlacePick } from "@/app/(customer)/actions";
import { useGeolocation } from "@/lib/hooks/use-geolocation";
import type {
  CheckoutDeliveryContext,
  CheckoutMerchantPosition,
} from "@/app/(customer)/checkout/context";

import {
  hasValidPosition,
  PositionStatus,
  ChoiceTile,
  SavedAddressesModal,
  FullscreenMap,
  SaveAddressInline,
  RecipientBlock,
  ModeTab,
  ModeButton,
  type DeliveryChoice,
  type PositionSource,
} from "./checkout-delivery-ui";

// Chemin d'import stable (checkout-view importe DeliveryChoice d'ici).
export type { DeliveryChoice } from "./checkout-delivery-ui";

export function CheckoutDeliverySection({
  delivery,
  merchantPosition,
  pricing,
  value,
  onChange,
  defaultPosition,
  cartSubtotalDa = 0,
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
  /** Sous-total panier (après promos produit) — pour l'étiquette « Livraison
   *  offerte » sur la carte Tournée (déjà acquise vs « dès X DA »). */
  cartSubtotalDa?: number;
}) {
  const t = useTranslations("checkout");
  const geo = useGeolocation();
  const update = (patch: Partial<DeliveryChoice>) =>
    onChange({ ...value, ...patch });

  // Toujours la DERNIÈRE valeur (pour les callbacks différés : reverse-geocode,
  // auto-confirmation). Évite de repartir d'un `value` figé dans une closure
  // (sinon un patch tardif écrase `positionConfirmed`/autres champs récents).
  const valueRef = useRef(value);
  valueRef.current = value;

  // « Modifier » rouvre les choix après repliement (position confirmée).
  const [editing, setEditing] = useState(false);
  // Choix actif (Ma position actuelle / Mes adresses / Sur la carte).
  const [source, setSource] = useState<PositionSource>(null);
  const [gpsState, setGpsState] = useState<"idle" | "loading" | "denied">(
    "idle"
  );
  const [addrModalOpen, setAddrModalOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

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

  const customOutOfRange = customQuote?.outOfRange ?? false;

  // Pose une position custom (GPS / carte / lieu nommé) puis auto-confirme si
  // elle est DANS la zone (sinon on laisse l'erreur rouge s'afficher).
  const pendingConfirm = useRef(false);
  function pickPosition(
    pos: { lat: number; lng: number },
    label?: string | null
  ) {
    pendingConfirm.current = true;
    onChange({
      ...value,
      addressId: null,
      customPosition: pos,
      customAddressText: label ?? null,
      positionConfirmed: false,
    });
    setEditing(false);
  }

  // Auto-confirmation : une fois le devis (zone) calculé pour le point fraîchement
  // posé, on confirme s'il est dans la zone et on l'enregistre dans l'historique.
  useEffect(() => {
    if (!pendingConfirm.current) return;
    if (!value.customPosition || customQuote == null) return;
    pendingConfirm.current = false;
    if (!customOutOfRange) {
      onChange({ ...valueRef.current, positionConfirmed: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customQuote, value.customPosition]);

  // Reverse-geocode du point custom sans libellé connu (GPS / carte) → adresse
  // exacte affichée + transmise au livreur. Lieux nommés : libellé déjà posé.
  const cpLat = value.customPosition?.lat ?? null;
  const cpLng = value.customPosition?.lng ?? null;
  const [addrLoading, setAddrLoading] = useState(false);
  useEffect(() => {
    if (cpLat == null || cpLng == null) return;
    if (value.customAddressText) return; // libellé déjà connu (lieu nommé)
    let alive = true;
    setAddrLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await reverseGeocode({ latitude: cpLat, longitude: cpLng });
        const label = res.ok
          ? (res.display ??
            [res.commune, res.wilaya_name].filter(Boolean).join(" · "))
          : null;
        if (alive && label) {
          onChange({ ...valueRef.current, customAddressText: label });
          void recordPlacePick({ lat: cpLat, lng: cpLng, label });
        }
      } finally {
        if (alive) setAddrLoading(false);
      }
    }, 500);
    return () => {
      alive = false;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpLat, cpLng]);

  // « Ma position actuelle » — détection GPS one-shot.
  async function detectCurrent() {
    setSource("current");
    setGpsState("loading");
    const c = await geo.requestOnce();
    if (!c) {
      setGpsState("denied");
      return;
    }
    setGpsState("idle");
    pickPosition({ lat: c.latitude, lng: c.longitude }, null);
  }

  // « Ma position actuelle » est le choix PAR DÉFAUT : à l'arrivée en livraison,
  // si rien n'est encore choisi, on lance une détection une seule fois.
  const autoDetectedRef = useRef(false);
  useEffect(() => {
    if (!delivery.enabled) return;
    if (value.fulfillment !== "delivery") return;
    if (autoDetectedRef.current) return;
    if (value.addressId || value.customPosition) return;
    autoDetectedRef.current = true;
    void detectCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.fulfillment, delivery.enabled]);

  if (!delivery.enabled) {
    // Livraison désactivée chez ce commerçant → uniquement le retrait, pas de
    // toggle (le créneau de retrait est rendu par le parent).
    return null;
  }

  const isDelivery = value.fulfillment === "delivery";
  const ready = hasValidPosition(value, selectedSavedAddress, customOutOfRange);
  const collapsed = isDelivery && ready && !editing;

  // Résumé de la position retenue (ligne repliée).
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
      <div className="bg-surface-2 rounded-card-xl relative flex p-[5px]">
        <span
          aria-hidden
          className={cn(
            "bg-surface rounded-control-lg absolute top-[5px] bottom-[5px] w-[calc(50%-5px)] shadow-[0_3px_10px_-2px_rgba(40,35,90,0.18)] transition-transform duration-300 ease-[cubic-bezier(.34,1.4,.64,1)]",
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
              className="border-border bg-surface co-rise flex w-full items-center gap-3 rounded-xl border p-3.5 text-start"
            >
              <span className="bg-primary-50 rounded-card relative grid size-[50px] shrink-0 place-items-center overflow-hidden">
                <MapPin
                  className="text-primary-600 size-5"
                  fill="currentColor"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground text-body-lg flex items-center gap-1.5 font-extrabold">
                  <Check className="text-success-600 size-4 shrink-0" />
                  {t("positionConfirmed")}
                </span>
                <span className="text-muted text-label mt-0.5 block truncate font-semibold">
                  {[
                    summaryLabel,
                    t("inZone"),
                    inZoneFee != null ? formatDA(inZoneFee) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="text-primary-700 text-body-sm shrink-0 font-extrabold">
                {t("change")}
              </span>
            </button>
          ) : (
            /* ── 3 choix de position (au lieu d'afficher la carte directement). ── */
            <div className="bg-surface co-rise space-y-2.5 overflow-hidden rounded-xl p-3">
              <p className="text-muted text-caption px-1 pt-0.5 font-extrabold tracking-wider uppercase">
                {t("whereToDeliver")}
              </p>

              {/* 3 tuiles côte à côte (une seule rangée compacte, style iOS) —
                  remplace 3 grandes lignes empilées qui mangeaient l'écran. */}
              <div className="grid grid-cols-3 gap-2">
                <ChoiceTile
                  icon={
                    gpsState === "loading" ? (
                      <Loader2 className="size-[18px] animate-spin" />
                    ) : (
                      <LocateFixed className="size-[18px]" />
                    )
                  }
                  label={t("tileMyPosition")}
                  active={source === "current"}
                  onClick={detectCurrent}
                />
                <ChoiceTile
                  icon={<Bookmark className="size-[18px]" />}
                  label={t("tileMyAddresses")}
                  active={source === "saved"}
                  onClick={() => {
                    setSource("saved");
                    setAddrModalOpen(true);
                  }}
                />
                <ChoiceTile
                  icon={<MapIcon className="size-[18px]" />}
                  label={t("tileOnMap")}
                  active={source === "map"}
                  onClick={() => {
                    setSource("map");
                    setMapOpen(true);
                  }}
                />
              </div>

              {/* État de la position choisie (détection / zone / erreur). */}
              <PositionStatus
                source={source}
                gpsState={gpsState}
                onRetryGps={detectCurrent}
                customPosition={value.customPosition}
                customAddressText={value.customAddressText}
                addrLoading={addrLoading}
                customQuote={customQuote}
                selectedSavedAddress={selectedSavedAddress}
                maxRadiusKm={merchantPosition?.radiusKm ?? null}
                mode={value.mode}
              />

              {/* Enregistrer le point custom confirmé dans le profil. */}
              {value.customPosition &&
                !customOutOfRange &&
                value.positionConfirmed && (
                  <SaveAddressInline
                    lat={value.customPosition.lat}
                    lng={value.customPosition.lng}
                    addressText={value.customAddressText}
                  />
                )}
            </div>
          )}

          {/* Mode + créneau + destinataire — révélés une fois la position prête. */}
          {ready && (
            <div className="border-border bg-surface space-y-4 rounded-xl border p-4">
              {(delivery.express_enabled || delivery.tours_enabled) && (
                <div className="space-y-2">
                  <p className="text-muted text-caption font-extrabold tracking-wider uppercase">
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
                        // Livraison offerte (mig 0331) : l'offre du commerçant ne
                        // vaut QUE pour la tournée → étiquette DANS la carte pour
                        // que le client comprenne où il en bénéficie.
                        badge={
                          delivery.free_delivery
                            ? cartSubtotalDa >=
                              delivery.free_delivery.min_subtotal_da
                              ? t("freeDeliveryBadge")
                              : t("freeDeliveryBadgeFrom", {
                                  amount: formatDA(
                                    delivery.free_delivery.min_subtotal_da
                                  ),
                                })
                            : null
                        }
                        active={value.mode === "tour"}
                        onClick={() => update({ mode: "tour" })}
                      />
                    )}
                  </div>
                </div>
              )}

              {value.mode === "tour" && (
                <div className="space-y-2">
                  <p className="text-muted text-caption font-extrabold tracking-wider uppercase">
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
                                "flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-start text-sm transition",
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
                                    timeZone: "Africa/Algiers",
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

      {/* ═══ Popup « Mes adresses enregistrées » (Favoris / Enregistrées / Précédents). ═══ */}
      {addrModalOpen && (
        <SavedAddressesModal
          addresses={delivery.addresses}
          onPickSaved={(a) => {
            setEditing(false);
            update({
              addressId: a.id,
              customPosition: null,
              customAddressText: null,
              positionConfirmed: false,
            });
            setAddrModalOpen(false);
          }}
          onPickPlace={(p) => {
            pickPosition({ lat: p.lat, lng: p.lng }, p.label);
            setAddrModalOpen(false);
          }}
          onClose={() => setAddrModalOpen(false)}
        />
      )}

      {/* ═══ Carte plein écran (même composant que l'accueil marketplace). ═══ */}
      {mapOpen && (
        <FullscreenMap
          initial={value.customPosition ?? defaultPosition ?? null}
          onValidate={(p) => {
            pickPosition(p, null);
            setMapOpen(false);
          }}
          onClose={() => setMapOpen(false)}
        />
      )}
    </section>
  );
}

/** True si on a un point de livraison utilisable (adresse OK ou custom en zone). */
