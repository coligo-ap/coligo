"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Store, Wallet } from "lucide-react";
import { watchPosition, type Coords } from "@/lib/native/geolocation";
import { haversineKm } from "@/lib/delivery/distance";
import { cashToCollectDa, isPrepaid } from "@/lib/delivery/cash";
import { DeliveryRouteMap } from "@/components/driver/delivery-route-map";
import { useAlertSound, vibrate } from "@/lib/hooks/use-alert-sound";
import {
  computeDriverNet,
  DEFAULT_DRIVER_FEE_CONFIG,
  type DriverFeeConfig,
} from "@/lib/driver/settlement";

/**
 * Écran 2 — OFFRE DE COURSE (plein écran BLANC, style Uber Eats Driver clair).
 *
 * La commande est DÉJÀ attribuée par le serveur (FIFO `pull_next_express` ou
 * dispatch par zone `pull_next_express_nearby`) au moment où cet écran
 * s'affiche. « Accepter » confirme et passe à la course en cours (écran 3) ;
 * « Refuser » libère la commande (cooldown 10 min). Aucune logique
 * d'attribution n'est ré-inventée ici.
 *
 * Infos trajet mises en avant pour décider vite : distance jusqu'au commerçant,
 * distance commerçant → client, distance/temps TOTAUX, et l'ENCAISSEMENT (0 DA
 * si la commande est déjà payée en ligne, montant cash sinon).
 */

type OfferOrder = {
  payment_method: "cash" | "online";
  total_da: number | null;
  delivery_fee_da: number | null;
  delivery_address_text: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
};

const KM_TO_MIN = 5; // ~12 km/h en ville (scooter + arrêts) → 5 min / km.

function fmtKm(km: number | null) {
  if (km == null) return "—";
  return km.toFixed(1).replace(".", ",");
}
function fmtLeg(km: number | null) {
  if (km == null) return "Calcul…";
  return `${fmtKm(km)} km · ${Math.max(1, Math.round(km * KM_TO_MIN))} min`;
}

const OFFER_SECONDS = 30; // Durée de l'offre avant libération automatique.

export function ExpressOffer({
  order,
  itemCount,
  merchantName,
  merchantLat,
  merchantLng,
  onAccept,
  onRefuse,
  onTimeout,
  refusing,
  driverFeeConfig,
}: {
  order: OfferOrder;
  itemCount: number;
  merchantName: string;
  merchantLat?: number | null;
  merchantLng?: number | null;
  onAccept: () => void;
  onRefuse: () => void;
  /** Appelé une seule fois quand le compte à rebours atteint 0 (libération). */
  onTimeout?: () => void;
  refusing: boolean;
  /** Config part Coligo (driver_fee), figée en base. Défaut = défauts SQL. */
  driverFeeConfig?: DriverFeeConfig;
}) {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [left, setLeft] = useState(OFFER_SECONDS);
  const firedTimeout = useRef(false);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;
  const { play, stop, unlock } = useAlertSound();

  // Sonnerie + vibration tant que l'offre est affichée (façon Uber/Yassir).
  // S'arrête à l'acceptation/au refus (démontage du composant).
  useEffect(() => {
    let active = true;
    void (async () => {
      await unlock();
      if (active) await play({ repeat: true, intervalMs: 2500 });
    })();
    vibrate([400, 200, 400, 200, 400]);
    return () => {
      active = false;
      stop();
    };
  }, [play, stop, unlock]);

  // Géoloc live (pour estimer les distances de l'offre).
  useEffect(() => {
    const h = watchPosition(
      (c) => setCoords(c),
      () => {},
      { enableHighAccuracy: true, maximumAge: 10_000 }
    );
    return () => h?.stop();
  }, []);

  // Compte à rebours d'acceptation : met la pression (façon Uber/Yassir). À
  // 0:00, la course est LIBÉRÉE automatiquement (onTimeout → release) pour
  // qu'elle reparte vers un autre livreur. Déclenché une seule fois.
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

  const legPickup = me && pickup ? haversineKm(me, pickup) : null;
  const legDrop = pickup && drop ? haversineKm(pickup, drop) : null;
  const totalKm =
    legPickup != null || legDrop != null
      ? (legPickup ?? 0) + (legDrop ?? 0)
      : null;
  const totalMin =
    totalKm != null ? Math.max(1, Math.round(totalKm * KM_TO_MIN)) : null;

  const fee = order.delivery_fee_da ?? 0;
  // Gain NET du livreur = D − driver_fee (la part Coligo livraison est prélevée
  // sur D). C'est ce que montre la maquette (« 184 DA · gain net »), pas le D
  // brut. Taux figé en base (driverFeeConfig), jamais codé en dur.
  const driverNet = computeDriverNet(
    fee,
    driverFeeConfig ?? DEFAULT_DRIVER_FEE_CONFIG
  );
  const prepaid = isPrepaid(order);
  const toCollect = cashToCollectDa(order);
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  // Pression visuelle : dans les 10 dernières secondes, le minuteur vire au
  // rouge et la barre se vide plus « chaud ».
  const urgent = left <= 10;
  const pct = Math.max(0, Math.min(100, (left / OFFER_SECONDS) * 100));
  const timerColor = urgent ? "#e53935" : "#6c2bd9";

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-white px-[22px] pt-[max(50px,calc(env(safe-area-inset-top)+18px))] pb-[max(22px,env(safe-area-inset-bottom))] text-[#0a0a0a]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold tracking-[2px] text-[#6c2bd9]">
          <span className="grid size-[18px] place-items-center rounded-md bg-[#6c2bd9] text-[11px] leading-none text-white">
            ⚡
          </span>
          EXPRESS COLIGO
        </span>
        <span
          className="inline-flex items-center gap-2 rounded-full px-3.5 py-[7px] text-sm font-black tabular-nums transition-colors"
          style={{
            background: urgent ? "rgba(229,57,53,.12)" : "rgba(108,43,217,.1)",
            color: urgent ? "#e53935" : "#6c2bd9",
          }}
        >
          <span
            className="size-3.5 rounded-full border-2 border-t-transparent"
            style={{
              borderColor: timerColor,
              borderTopColor: "transparent",
              animation: "driver-spin 1s linear infinite",
            }}
          />
          {mm}:{ss}
        </span>
      </div>

      {/* Barre de minuteur — se vide en temps réel pour matérialiser l'urgence. */}
      <div className="mt-3 h-[5px] w-full overflow-hidden rounded-full bg-[#eee]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: urgent
              ? "linear-gradient(90deg,#e53935,#ff8a85)"
              : "linear-gradient(90deg,#6c2bd9,#8a4dff)",
            transition: "width 1s linear, background .3s ease",
          }}
        />
      </div>

      {/* Zone scrollable : le contenu peut défiler sans pousser les boutons. */}
      <div className="-mx-[22px] min-h-0 flex-1 overflow-y-auto px-[22px]">
        {/* Bloc principal : distance totale + gain violet */}
        <div className="mt-6 flex items-end justify-between">
          <div>
            <div className="text-[10.5px] font-semibold tracking-[0.4px] text-[#9e9e9e] uppercase">
              Distance totale
            </div>
            <h1 className="text-[32px] leading-none font-extrabold tracking-[-1px]">
              {fmtKm(totalKm)}
              <span className="ml-1 text-[14px] font-semibold text-[#9e9e9e]">
                km
              </span>
            </h1>
            {totalMin != null && (
              <div className="mt-1 text-[13px] font-semibold text-[#757575]">
                ~{totalMin} min de trajet
              </div>
            )}
          </div>
          <div className="rounded-[16px] border border-[#e0e0f5] bg-[#f4f4fb] px-4 py-2.5 text-right">
            <div className="text-[26px] leading-none font-extrabold tracking-[-0.6px] text-[#6c2bd9]">
              {driverNet}
              <span className="ml-1 text-[13px] font-bold text-[#9e9e9e]">
                DA
              </span>
            </div>
            <div className="mt-1 text-[10.5px] font-semibold tracking-[0.4px] text-[#757575]">
              Votre gain net
            </div>
          </div>
        </div>

        {/* Encaissement : 0 DA si déjà payé en ligne, montant cash sinon. */}
        <div
          className={
            "mt-[18px] flex items-center gap-2.5 rounded-[14px] border px-4 py-3.5 " +
            (prepaid
              ? "border-[#b6e2c6] bg-[#effaf3] text-[#1d7a44]"
              : "border-[#f5e0a1] bg-[#fff8e5] text-[#8b6500]")
          }
        >
          <Wallet className="size-[18px] shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-extrabold">
              {prepaid ? "Déjà payé en ligne" : "À encaisser auprès du client"}
            </div>
            <div className="text-[11px] font-medium opacity-80">
              {prepaid
                ? "Le client a tout réglé — ne rien demander"
                : "Le client règle en espèces à la remise"}
            </div>
          </div>
          <b className="text-[17px] font-extrabold tabular-nums">
            {prepaid ? 0 : toCollect}
            <span className="ml-0.5 text-[11px] font-bold">DA</span>
          </b>
        </div>

        {/* Chips */}
        <div className="mt-[14px] flex flex-wrap gap-2">
          <Chip violet>⚡ Express</Chip>
          <Chip>
            {order.payment_method === "cash" ? "💵 Cash" : "💳 Payé en ligne"}
          </Chip>
          {itemCount > 0 && (
            <Chip>
              📦 {itemCount} article{itemCount > 1 ? "s" : ""}
            </Chip>
          )}
        </div>

        {/* Carte + tracé de l'itinéraire (vers le commerçant à récupérer) :
          le livreur voit le chemin réel et l'ETA dès la réception de l'offre. */}
        {pickup && (
          <div className="mt-[18px] overflow-hidden rounded-[14px] border border-[#eee]">
            <DeliveryRouteMap
              target={pickup}
              label="Vers le commerçant"
              height={180}
            />
          </div>
        )}

        {/* Bloc trajet détaillé */}
        <div className="mt-[18px] rounded-[14px] border border-[#eee] bg-[#fafafa] p-4">
          <div className="flex gap-3.5">
            <div className="flex flex-col items-center pt-[5px]">
              <span className="grid size-[22px] place-items-center rounded-full bg-[#0a0a0a] text-white">
                <Store className="size-[12px]" />
              </span>
              <span
                className="my-1 w-0.5 flex-1"
                style={{
                  minHeight: 28,
                  backgroundImage:
                    "linear-gradient(to bottom,#ccc 50%,transparent 50%)",
                  backgroundSize: "2px 6px",
                }}
              />
              <span className="grid size-[22px] place-items-center rounded-full bg-[#6c2bd9] text-white">
                <MapPin className="size-[12px]" />
              </span>
            </div>
            <div className="flex-1">
              <div className="mb-3.5">
                <small className="text-[10px] font-bold tracking-[1px] text-[#9e9e9e]">
                  RÉCUPÉRER CHEZ
                </small>
                <div className="mt-[3px] text-[13.5px] font-semibold">
                  {merchantName}
                </div>
                <div className="mt-px text-[11px] font-medium text-[#757575]">
                  Vous → commerçant : {fmtLeg(legPickup)}
                </div>
              </div>
              <div>
                <small className="text-[10px] font-bold tracking-[1px] text-[#9e9e9e]">
                  LIVRER AU CLIENT
                </small>
                <div className="mt-[3px] text-[13.5px] font-semibold">
                  {order.delivery_address_text ?? "Adresse client"}
                </div>
                <div className="mt-px text-[11px] font-medium text-[#757575]">
                  Commerçant → client : {fmtLeg(legDrop)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2.5 pt-[14px]">
        <button
          type="button"
          onClick={onRefuse}
          disabled={refusing}
          className="flex flex-1 items-center justify-center rounded-[14px] bg-[#f2f2f2] py-[17px] text-[15px] font-extrabold text-[#0a0a0a] active:scale-[0.99] disabled:opacity-60"
        >
          {refusing ? <Loader2 className="size-5 animate-spin" /> : "Refuser"}
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={refusing}
          className="flex-[2] rounded-[14px] py-[17px] text-[15px] font-extrabold text-white active:scale-[0.99] disabled:opacity-60"
          style={{
            background: "linear-gradient(135deg,#5b2eff,#6c2bd9)",
            boxShadow: "0 8px 24px rgba(108,43,217,.35)",
          }}
        >
          Accepter la course
        </button>
      </div>
    </div>
  );
}

function Chip({
  children,
  violet,
}: {
  children: React.ReactNode;
  violet?: boolean;
}) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold " +
        (violet ? "bg-[#6c2bd9]/12 text-[#6c2bd9]" : "bg-[#f2f2f2] text-[#444]")
      }
    >
      {children}
    </span>
  );
}
