"use client";

import { useState } from "react";
import { ArrowRight, Loader2, MessageCircle, Phone, X } from "lucide-react";
import { ExpressRunMap } from "./express-run-map";
import { OrderChat } from "@/components/chat/order-chat";

/**
 * Écran 3 — COURSE EN COURS (plein écran, style Uber Eats Driver).
 *
 * Carte plein écran avec itinéraire néon + bandeau d'étape flottant + bottom
 * sheet (profil de l'étape, adresse, encaissement cash, CTA d'avancement).
 * Purement visuel : les actions (`onPickup` / `onArrived` / `onValidate`) et
 * leur logique métier vivent dans le parent `ExpressCard` — on ne fait que les
 * brancher sur des boutons.
 *
 * Étapes :
 *  - !pickedUp            → ÉTAPE 1 « Récupérer la commande » (cible : commerçant)
 *  - pickedUp & !arrived  → ÉTAPE 2 « Livrer au client »      (cible : client)
 *  - pickedUp &  arrived  → ÉTAPE 2, CTA « Scanner / Saisir le code » (→ écran 4)
 */

type RunOrder = {
  id: string;
  order_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  total_da: number | null;
  payment_method: "cash" | "online";
  delivery_address_text: string | null;
  delivery_phone: string | null;
  delivery_recipient_name: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
};

function shortRef(id: string) {
  return id.replace(/-/g, "").slice(0, 6).toUpperCase();
}

export function ExpressRun({
  order,
  itemCount,
  merchantName,
  merchantLat,
  merchantLng,
  pickedUp,
  arrived,
  pending,
  onPickup,
  onArrived,
  onValidate,
}: {
  order: RunOrder;
  itemCount: number;
  merchantName: string;
  merchantLat?: number | null;
  merchantLng?: number | null;
  pickedUp: boolean;
  arrived: boolean;
  pending: boolean;
  onPickup: () => void;
  onArrived: () => void;
  onValidate: () => void;
}) {
  const [eta, setEta] = useState<{ min: number; km: number } | null>(null);
  const [showChat, setShowChat] = useState(false);

  // Cible courante : commerçant avant pickup, client après.
  const target = pickedUp
    ? order.delivery_lat != null && order.delivery_lng != null
      ? { lat: order.delivery_lat, lng: order.delivery_lng }
      : null
    : merchantLat != null && merchantLng != null
      ? { lat: merchantLat, lng: merchantLng }
      : null;

  const stepNum = pickedUp ? 2 : 1;
  const stepTitle = pickedUp ? "Livrer au client" : "Récupérer la commande";

  // Profil de l'étape : commerçant (récup) ou client (livraison).
  const who = pickedUp
    ? {
        name: order.delivery_recipient_name ?? order.customer_name ?? "Client",
        initial: (order.delivery_recipient_name ?? order.customer_name ?? "C")
          .charAt(0)
          .toUpperCase(),
        phone: order.delivery_phone ?? order.customer_phone,
      }
    : {
        name: merchantName,
        initial: merchantName.charAt(0).toUpperCase(),
        phone: null as string | null,
      };

  const address = pickedUp
    ? (order.delivery_address_text ?? "Adresse client")
    : merchantName;

  const showCash = order.payment_method === "cash";

  const gmapsUrl = target
    ? `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`
    : null;

  return (
    <div className="fixed inset-0 z-[80] bg-[#f2f2f2] text-[#0a0a0a]">
      {/* Carte plein écran (ou repli si pas de coordonnées cible). */}
      {target ? (
        <ExpressRunMap
          target={target}
          kind={pickedUp ? "drop" : "pickup"}
          onEta={setEta}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-[#e8e8e8] px-8 text-center text-sm font-medium text-[#757575]">
          Position de destination indisponible — utilise l&apos;adresse
          ci-dessous.
        </div>
      )}

      {/* Bandeau d'étape flottant. */}
      <div className="absolute top-[max(46px,calc(env(safe-area-inset-top)+14px))] right-3.5 left-3.5 z-50 flex items-center gap-3 rounded-[14px] bg-black px-4 py-[13px] text-white shadow-[0_8px_22px_rgba(0,0,0,.2)]">
        <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-[#5c5ce0] text-[13px] font-extrabold text-white">
          {stepNum}
        </span>
        <div className="flex-1">
          <small className="text-[10px] font-bold tracking-[0.8px] uppercase opacity-55">
            Étape en cours
          </small>
          <b className="mt-px block text-sm font-semibold">{stepTitle}</b>
        </div>
        <div className="text-right">
          <b className="block text-[15px] font-extrabold text-[#5c5ce0]">
            {eta ? `${eta.min} min` : "…"}
          </b>
          <small className="text-[10px] opacity-60">
            {eta ? `${eta.km.toFixed(1).replace(".", ",")} km` : ""}
          </small>
        </div>
      </div>

      {/* Bottom sheet. */}
      <div className="absolute right-0 bottom-0 left-0 z-[60] rounded-t-[18px] bg-white pt-2 pb-[max(18px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,.1)]">
        <div className="mx-auto mt-1 mb-1 h-1 w-[42px] rounded-full bg-[#e0e0e0]" />

        <div className="px-[18px] pt-1.5">
          {/* Profil de l'étape. */}
          <div className="flex items-center gap-[11px] border-b border-[#eee] pb-3.5">
            <div className="grid size-[46px] place-items-center rounded-full bg-[#f5f5f5] text-[18px] font-extrabold text-[#0a0a0a]">
              {who.initial}
            </div>
            <div className="min-w-0 flex-1">
              <b className="block truncate text-base font-bold text-[#0a0a0a]">
                {who.name}
              </b>
              <small className="text-xs font-medium text-[#757575]">
                Commande #{order.order_number ?? shortRef(order.id)}
                {itemCount > 0
                  ? ` · ${itemCount} article${itemCount > 1 ? "s" : ""}`
                  : ""}
              </small>
            </div>
            {pickedUp && (
              <button
                type="button"
                onClick={() => setShowChat(true)}
                aria-label="Discuter avec le client"
                className="grid size-[42px] place-items-center rounded-full bg-[#f5f5f5] text-[#000] active:scale-95"
              >
                <MessageCircle className="size-[17px]" />
              </button>
            )}
            {who.phone && (
              <a
                href={`tel:${who.phone}`}
                aria-label="Appeler"
                className="grid size-[42px] place-items-center rounded-full bg-[#f5f5f5] text-[#000] active:scale-95"
              >
                <Phone className="size-[17px]" />
              </a>
            )}
          </div>

          {/* Pill adresse. */}
          <div className="my-3.5 flex items-center gap-2.5 rounded-[11px] bg-[#f8f8f8] px-3.5 py-3 text-[13px] font-semibold text-[#0a0a0a]">
            <span className="text-[15px]">📍</span>
            <span className="min-w-0 flex-1">{address}</span>
          </div>

          {/* Pill encaissement cash. */}
          {showCash && (
            <div className="mb-3.5 flex items-center gap-2.5 rounded-[11px] border border-[#f5e0a1] bg-[#fff8e5] px-3.5 py-[13px] text-[13px] font-bold text-[#8b6500]">
              <span>💵</span>
              <span>Encaisser</span>
              <b className="ml-auto text-sm">
                {order.total_da != null ? `${order.total_da} DA` : "—"}
              </b>
            </div>
          )}
        </div>

        {/* Actions. */}
        <div className="space-y-2 px-[18px]">
          {!pickedUp && (
            <CtaButton onClick={onPickup} pending={pending}>
              J&apos;ai récupéré la commande
            </CtaButton>
          )}
          {pickedUp && !arrived && (
            <CtaButton onClick={onArrived} pending={pending}>
              Je suis arrivé chez le client
            </CtaButton>
          )}
          {pickedUp && arrived && (
            <CtaButton onClick={onValidate} pending={pending}>
              Scanner / Saisir le code
            </CtaButton>
          )}

          {gmapsUrl && (
            <a
              href={gmapsUrl}
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-[13px] bg-[#f5f5f5] py-[15px] text-[15px] font-extrabold text-[#0a0a0a] active:scale-[0.99]"
            >
              Voir l&apos;itinéraire
              <ArrowRight className="size-[18px]" />
            </a>
          )}
        </div>
      </div>

      {/* Modale chat avec le client (messages prédéfinis). */}
      {showChat && (
        <div
          className="absolute inset-0 z-[90] flex items-end bg-black/40"
          onClick={() => setShowChat(false)}
        >
          <div
            className="w-full rounded-t-[18px] bg-white p-3 pb-[max(18px,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <b className="text-sm font-bold text-[#0a0a0a]">
                Discuter avec {who.name}
              </b>
              <button
                type="button"
                onClick={() => setShowChat(false)}
                aria-label="Fermer"
                className="grid size-8 place-items-center rounded-full bg-[#f5f5f5] active:scale-95"
              >
                <X className="size-4" />
              </button>
            </div>
            <OrderChat
              orderId={order.id}
              role="courier"
              phone={who.phone}
              phoneLabel={`Appeler ${who.name}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CtaButton({
  children,
  onClick,
  pending,
}: {
  children: React.ReactNode;
  onClick: () => void;
  pending: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="flex w-full items-center justify-center gap-2 rounded-[13px] bg-[#0a0a0a] py-[16px] text-[15px] font-extrabold text-white active:scale-[0.99] disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-5 animate-spin" /> : children}
    </button>
  );
}
