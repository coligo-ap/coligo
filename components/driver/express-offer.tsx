"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { watchPosition, type Coords } from "@/lib/native/geolocation";
import { DeliveryRouteMap } from "./delivery-route-map";
import { DriverCourseDrawer } from "./course/driver-course-drawer";
import { scooterCourseEta } from "@/lib/delivery/scooter";
import { cashToCollectDa, isPrepaid } from "@/lib/delivery/cash";
import { useAlertSound, vibrate } from "@/lib/hooks/use-alert-sound";
import { isDriverSoundOn } from "@/lib/driver/sound-store";
import {
  computeDriverNet,
  DEFAULT_DRIVER_FEE_CONFIG,
  type DriverFeeConfig,
} from "@/lib/driver/settlement";

/**
 * Écran OFFRE DE COURSE reproduit À L'IDENTIQUE de MAQUETTE-livreur-uber
 * (.offer-card violette qui monte du bas) : minuteur d'acceptation synchronisé
 * à 3 endroits (barre .count en haut, .pfill dans la pastille, compteur dans le
 * bouton Accepter), GAIN NET en très gros (D − driver_fee), sous-titre, ligne
 * temps·km, 2 arrêts sur rail pointillé (retrait → livraison) + encart cash.
 *
 * La commande est DÉJÀ attribuée côté serveur quand cet écran s'affiche.
 * « Accepter » → course en cours ; ✕ / expiration → libère (cooldown).
 */

type OfferOrder = {
  payment_method: "cash" | "online";
  total_da: number | null;
  delivery_fee_da: number | null;
  delivery_address_text: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
};

const OFFER_SECONDS = 30; // durée avant libération automatique.

function fmtKm(km: number | null) {
  if (km == null) return "—";
  return km.toFixed(1).replace(".", ",");
}

export function ExpressOffer({
  order,
  merchantName,
  merchantLat,
  merchantLng,
  onAccept,
  onRefuse,
  onTimeout,
  refusing,
  driverFeeConfig,
  error,
}: {
  order: OfferOrder;
  merchantName: string;
  merchantLat?: number | null;
  merchantLng?: number | null;
  onAccept: () => void;
  onRefuse: () => void;
  onTimeout?: () => void;
  refusing: boolean;
  driverFeeConfig?: DriverFeeConfig;
  /** Erreur d'action (refus impossible…) affichée EN LIGNE sous les boutons. */
  error?: string | null;
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [left, setLeft] = useState(OFFER_SECONDS);
  const firedTimeout = useRef(false);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;
  // Sonnerie dédiée « réception de course » (fichier partagé livreur/chauffeur).
  const { play, stop, unlock } = useAlertSound("/sounds/new-request.mp3");

  // Sonnerie + vibration tant que l'offre est affichée (cf. son maquette). La
  // sonnerie respecte la préférence « Sons » du livreur ; la vibration reste.
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!isDriverSoundOn()) return;
      await unlock();
      if (active) await play({ repeat: true, intervalMs: 2500 });
    })();
    vibrate([0, 90, 50, 90]);
    return () => {
      active = false;
      stop();
    };
  }, [play, stop, unlock]);

  // Géoloc live (distances de l'offre).
  useEffect(() => {
    const h = watchPosition(
      (c) => setCoords(c),
      () => {},
      { enableHighAccuracy: true, maximumAge: 10_000 }
    );
    return () => h?.stop();
  }, []);

  // Minuteur d'acceptation → libération à 0:00 (une seule fois).
  useEffect(() => {
    if (left <= 0) {
      if (!firedTimeout.current) {
        firedTimeout.current = true;
        onTimeoutRef.current?.();
      }
      return;
    }
    const t = setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const me = coords ? { lat: coords.latitude, lng: coords.longitude } : null;
  const pickup =
    merchantLat != null && merchantLng != null
      ? { lat: merchantLat, lng: merchantLng }
      : null;
  const drop =
    order.delivery_lat != null && order.delivery_lng != null
      ? { lat: order.delivery_lat, lng: order.delivery_lng }
      : null;
  // ETA de la course COMPLÈTE, calculée façon SCOOTER (source unique).
  const eta = scooterCourseEta(me, pickup, drop);
  const totalKm = eta?.km ?? null;
  const totalMin = eta?.min ?? null;

  const fee = order.delivery_fee_da ?? 0;
  const driverNet = computeDriverNet(
    fee,
    driverFeeConfig ?? DEFAULT_DRIVER_FEE_CONFIG
  );
  const prepaid = isPrepaid(order);
  const toCollect = cashToCollectDa(order);
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  const fillStyle = {
    transform: `scaleX(${Math.max(0, left / OFFER_SECONDS)})`,
  };

  const clientPos =
    order.delivery_lat != null && order.delivery_lng != null
      ? { lat: order.delivery_lat, lng: order.delivery_lng }
      : null;
  const merchantPos =
    merchantLat != null && merchantLng != null
      ? { lat: merchantLat, lng: merchantLng }
      : null;

  return (
    /*
     * `over-nav` : l'écran s'arrête AU-DESSUS de la barre d'onglets, qui reste
     * visible et utilisable. Le positionnement vit dans `maquette.css` : une
     * classe Tailwind `fixed` (0,1,0) perdrait contre `[data-space] .mq-screen`
     * (0,2,0), dont le `position: relative` gagnait — cet écran n'était même pas
     * fixe, il paraissait plein grâce à `min-height: 100dvh`.
     */
    <div className="mq-screen over-nav z-[90]">
      {/*
       * La VRAIE carte, avec l'itinéraire complet : position actuelle →
       * commerçant → client. Avant, un simple dégradé (`.mq-map`) la remplaçait
       * et masquait tout : le livreur acceptait une course à l'aveugle.
       */}
      {clientPos ? (
        <DeliveryRouteMap target={clientPos} via={merchantPos} fill />
      ) : (
        <div className="mq-map" />
      )}
      {/* Voile léger EN HAUT seulement (lisibilité du menu) — la carte reste
          claire et lisible ailleurs (fini le voile sombre plein écran). */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-28"
        style={{
          background:
            "linear-gradient(to bottom, rgba(8,9,16,.28), transparent)",
        }}
      />

      {/* Menu (drawer) — la nav du bas et le menu restent accessibles pendant
          la réception de la commande. */}
      <DriverCourseDrawer />

      <div className="offer-card">
        {/* Minuteur — barre du haut. */}
        <div className="count">
          <div className="fill" style={fillStyle} />
        </div>
        <div className="oc-pad">
          <div className="oc-top">
            {/* Badge ambre « ⚡ Express » (cf. PROMPT §D + maquette COMPLETE). */}
            <div className="offer-pill ex">
              {/* Minuteur — pastille qui se vide. */}
              <span className="pfill" style={fillStyle} />
              <span className="ptxt">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
                </svg>
                {tr("Express", "سريع")}
              </span>
            </div>
            <button
              type="button"
              className="oc-x"
              onClick={onRefuse}
              disabled={refusing}
              aria-label={tr("Refuser", "رفض")}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth={2.2}
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div className="oc-pay">
            {driverNet} <small>DA</small>
          </div>
          <div className="oc-sub">
            {tr(
              "Gain net estimé pour la course",
              "الربح الصافي المقدّر للتوصيلة"
            )}
          </div>

          <div className="oc-line">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            {totalMin != null
              ? isAr
                ? `${totalMin} د · ${fmtKm(totalKm)} كم إجمالاً`
                : `${totalMin} min · ${fmtKm(totalKm)} km au total`
              : tr("Calcul de l'itinéraire…", "حساب المسار…")}
          </div>

          <div className="oc-stops">
            <div className="stop">
              <div className="rail">
                <span className="d s" />
                <span className="ln" />
              </div>
              <div className="nm">
                {merchantName}
                <small>{tr("Retrait · commerçant", "الاستلام · التاجر")}</small>
              </div>
            </div>
            <div className="stop">
              <div className="rail">
                <span className="d e" />
              </div>
              <div className="nm">
                {order.delivery_address_text ??
                  tr("Adresse client", "عنوان الزبون")}
                <small>
                  {tr("Livraison", "التسليم")} ·{" "}
                  {prepaid
                    ? tr("déjà payé en ligne", "مدفوع مسبقاً عبر الإنترنت")
                    : isAr
                      ? `تحصيل ${toCollect} دج نقداً`
                      : `à encaisser ${toCollect} DA espèces`}
                </small>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="accept"
            onClick={onAccept}
            disabled={refusing}
          >
            {tr("Accepter", "قبول")}{" "}
            <span className="t">
              {mm}:{ss}
            </span>
          </button>

          {error && (
            <p
              style={{
                marginTop: 10,
                textAlign: "center",
                fontSize: 12.5,
                fontWeight: 600,
                color: "#ffd7d3",
              }}
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
