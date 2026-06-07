"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { watchPosition, type Coords } from "@/lib/native/geolocation";
import { haversineKm } from "@/lib/delivery/distance";
import { DeliveryRouteMap } from "@/components/driver/delivery-route-map";
import { useAlertSound, vibrate } from "@/lib/hooks/use-alert-sound";

/**
 * Écran 2 — OFFRE DE COURSE (plein écran noir, style Uber Eats Driver).
 *
 * La commande est DÉJÀ attribuée par le serveur (FIFO `pull_next_express`) au
 * moment où cet écran s'affiche. « Accepter » confirme et passe à la course en
 * cours (écran 3) ; « Refuser » libère la commande (cooldown 10 min) via
 * `release_express_order`. Aucune logique d'attribution n'est ré-inventée ici.
 */

type OfferOrder = {
  payment_method: "cash" | "online";
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

export function ExpressOffer({
  order,
  itemCount,
  merchantName,
  merchantLat,
  merchantLng,
  onAccept,
  onRefuse,
  refusing,
}: {
  order: OfferOrder;
  itemCount: number;
  merchantName: string;
  merchantLat?: number | null;
  merchantLng?: number | null;
  onAccept: () => void;
  onRefuse: () => void;
  refusing: boolean;
}) {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [left, setLeft] = useState(30);
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

  // Compte à rebours d'urgence (visuel). Se fige à 0:00 — aucune action auto :
  // le livreur choisit explicitement Accepter / Refuser.
  useEffect(() => {
    if (left <= 0) return;
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
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-[#0a0a0a] px-[22px] pt-[max(50px,calc(env(safe-area-inset-top)+18px))] pb-[max(22px,env(safe-area-inset-bottom))] text-white">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-extrabold tracking-[2px] opacity-60">
          NOUVELLE COURSE
        </span>
        <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-[7px] text-sm font-extrabold backdrop-blur">
          <span
            className="size-3.5 rounded-full border-2 border-[#5c5ce0] border-t-transparent"
            style={{ animation: "driver-spin 1s linear infinite" }}
          />
          {mm}:{ss}
        </span>
      </div>

      {/* Zone scrollable : le contenu peut défiler sans pousser les boutons. */}
      <div className="-mx-[22px] min-h-0 flex-1 overflow-y-auto px-[22px]">
        {/* Bloc principal : distance + montant violet */}
        <div className="mt-6 flex items-end justify-between">
          <h1 className="text-[48px] leading-none font-black tracking-[-1.5px]">
            {fmtKm(totalKm)}
            <span className="ml-1 text-[18px] font-semibold opacity-60">
              km
            </span>
          </h1>
          <div className="text-right">
            <div className="text-[36px] leading-none font-black tracking-[-1px] text-[#5c5ce0]">
              {fee}
            </div>
            <div className="mt-1 text-[13px] font-semibold tracking-[0.5px] opacity-60">
              DA
            </div>
          </div>
        </div>

        {/* Chips */}
        <div className="mt-[18px] flex flex-wrap gap-2">
          <Chip violet>⚡ Express</Chip>
          <Chip>
            {order.payment_method === "cash" ? "💵 Cash" : "💳 Payé en ligne"}
          </Chip>
          {itemCount > 0 && (
            <Chip>
              📦 {itemCount} article{itemCount > 1 ? "s" : ""}
            </Chip>
          )}
          {totalMin != null && <Chip>~{totalMin} min</Chip>}
        </div>

        {/* Carte + tracé de l'itinéraire (vers le commerçant à récupérer) :
          le livreur voit le chemin réel et l'ETA dès la réception de l'offre. */}
        {pickup && (
          <div className="mt-[18px] overflow-hidden rounded-[14px]">
            <DeliveryRouteMap
              target={pickup}
              label="Vers le commerçant"
              height={180}
            />
          </div>
        )}

        {/* Bloc trajet */}
        <div className="mt-[22px] flex gap-3.5 rounded-[14px] bg-white/[0.04] p-4">
          <div className="flex flex-col items-center pt-[5px]">
            <span className="size-[11px] rounded-full bg-white" />
            <span
              className="my-1 w-0.5 flex-1"
              style={{
                minHeight: 30,
                backgroundImage:
                  "linear-gradient(to bottom,#666 50%,transparent 50%)",
                backgroundSize: "2px 6px",
              }}
            />
            <span className="size-[11px] rounded-[2px] bg-[#5c5ce0]" />
          </div>
          <div className="flex-1">
            <div className="mb-3.5">
              <small className="text-[10px] font-bold tracking-[1px] opacity-50">
                RÉCUPÉRER
              </small>
              <div className="mt-[3px] text-[13.5px] font-semibold">
                {merchantName}
              </div>
              <div className="mt-px text-[11px] font-medium opacity-60">
                {fmtLeg(legPickup)}
              </div>
            </div>
            <div>
              <small className="text-[10px] font-bold tracking-[1px] opacity-50">
                LIVRER À
              </small>
              <div className="mt-[3px] text-[13.5px] font-semibold">
                {order.delivery_address_text ?? "Adresse client"}
              </div>
              <div className="mt-px text-[11px] font-medium opacity-60">
                {fmtLeg(legDrop)}
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
          className="flex flex-1 items-center justify-center rounded-[14px] bg-white/[0.08] py-[17px] text-[15px] font-extrabold text-white disabled:opacity-60"
        >
          {refusing ? <Loader2 className="size-5 animate-spin" /> : "Refuser"}
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={refusing}
          className="flex-[2] rounded-[14px] bg-white py-[17px] text-[15px] font-extrabold text-black disabled:opacity-60"
        >
          Accepter
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
        (violet
          ? "bg-[#5c5ce0]/20 text-[#a8a8ff]"
          : "bg-white/[0.08] text-white")
      }
    >
      {children}
    </span>
  );
}
