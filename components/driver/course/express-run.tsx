"use client";

import { useState } from "react";
import { ArrowRight, MessageCircle, Phone, X } from "lucide-react";
import { ExpressRunMap } from "./express-run-map";
import { OrderChat } from "@/components/chat/order-chat";
import { cashToCollectDa, isPrepaid } from "@/lib/delivery/cash";

/**
 * Écran NAVIGATION ACTIVE (course en cours) reproduit À L'IDENTIQUE de
 * MAQUETTE-livreur-pages : carte plein écran + .navbanner (direction : distance
 * + étape + rue) + .navsheet (étape en cours : icône, titre, adresse, ETA +
 * bouton « Je suis arrivé »). Fonctions conservées (chat, appel, itinéraire).
 * La logique métier vit dans le parent ExpressCard.
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

  const target = pickedUp
    ? order.delivery_lat != null && order.delivery_lng != null
      ? { lat: order.delivery_lat, lng: order.delivery_lng }
      : null
    : merchantLat != null && merchantLng != null
      ? { lat: merchantLat, lng: merchantLng }
      : null;

  const who = pickedUp
    ? {
        name: order.delivery_recipient_name ?? order.customer_name ?? "Client",
        phone: order.delivery_phone ?? order.customer_phone,
      }
    : { name: merchantName, phone: null as string | null };

  const address = pickedUp
    ? (order.delivery_address_text ?? "Adresse client")
    : merchantName;
  const stepTitle = pickedUp
    ? `Livrer à ${who.name}`
    : `Récupérer chez ${merchantName}`;

  const prepaid = isPrepaid(order);
  const toCollect = cashToCollectDa(order);

  const gmapsUrl = target
    ? `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`
    : null;

  const cta = pickedUp
    ? arrived
      ? { label: "Scanner / Saisir le code", onClick: onValidate }
      : { label: "Je suis arrivé chez le client", onClick: onArrived }
    : { label: "J'ai récupéré la commande", onClick: onPickup };

  return (
    <div className="mq-screen fixed inset-0 z-[80]">
      {target ? (
        <ExpressRunMap
          target={target}
          kind={pickedUp ? "drop" : "pickup"}
          onEta={setEta}
        />
      ) : (
        <div
          className="absolute inset-0 grid place-items-center px-8 text-center"
          style={{ background: "var(--block)", color: "var(--muted)" }}
        >
          Position de destination indisponible — utilise l&apos;adresse
          ci-dessous.
        </div>
      )}

      {/* Bandeau direction. */}
      <div
        className="navbanner"
        style={{ top: "max(14px,env(safe-area-inset-top))" }}
      >
        <div className="ar">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
        <div>
          <div className="d">
            {eta ? `${eta.km.toFixed(1).replace(".", ",")} km` : "…"}
          </div>
          <div className="s">
            {stepTitle}
            {address && address !== merchantName ? ` · ${address}` : ""}
          </div>
        </div>
      </div>

      {/* Feuille basse : étape en cours. */}
      <div className="navsheet">
        <div className="step">
          <div className="dot">
            {pickedUp ? (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 11l9-8 9 8M5 10v10h14V10" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 9l1-5h16l1 5M5 9v11h14V9M9 13h6" />
              </svg>
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <b>{stepTitle}</b>
            <span
              style={{
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {address} · #{order.order_number ?? shortRef(order.id)}
              {itemCount > 0
                ? ` · ${itemCount} article${itemCount > 1 ? "s" : ""}`
                : ""}
            </span>
          </div>
          <span className="eta">{eta ? `${eta.min} min` : "…"}</span>
        </div>

        {/* Encaissement à la livraison. */}
        {prepaid ? (
          <div className="cash" style={{ marginTop: 0, marginBottom: 12 }}>
            <div className="l">✅ Déjà payé en ligne</div>
            <div className="am">0 DA</div>
          </div>
        ) : (
          <div
            className="cash"
            style={{
              marginTop: 0,
              marginBottom: 12,
              background: "rgba(243,156,18,.12)",
            }}
          >
            <div className="l" style={{ color: "#8b6500" }}>
              💵 À encaisser à la livraison
            </div>
            <div className="am" style={{ color: "#8b6500" }}>
              {toCollect} DA
            </div>
          </div>
        )}

        <button
          type="button"
          className="mq-btn"
          style={{ marginTop: 0 }}
          onClick={cta.onClick}
          disabled={pending}
        >
          {pending ? "…" : cta.label}
        </button>

        {/* Actions secondaires. */}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {gmapsUrl && (
            <a
              href={gmapsUrl}
              target="_blank"
              rel="noreferrer"
              className="btnlink"
              style={{
                flex: 1,
                marginTop: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              Itinéraire <ArrowRight className="size-4" />
            </a>
          )}
          {pickedUp && (
            <button
              type="button"
              onClick={() => setShowChat(true)}
              className="btnlink"
              style={{ flex: 1, marginTop: 0 }}
            >
              <MessageCircle className="mr-1 inline size-4" />
              Message
            </button>
          )}
          {who.phone && (
            <a
              href={`tel:${who.phone}`}
              className="btnlink"
              style={{ flex: 1, marginTop: 0 }}
            >
              <Phone className="mr-1 inline size-4" />
              Appeler
            </a>
          )}
        </div>
      </div>

      {/* Modale chat avec le client (messages prédéfinis). */}
      {showChat && (
        <div
          className="absolute inset-0 z-[90] flex items-end"
          style={{ background: "rgba(0,0,0,.4)" }}
          onClick={() => setShowChat(false)}
        >
          <div
            className="w-full rounded-t-[18px] bg-[var(--surface)] p-3 pb-[max(18px,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <b className="text-sm font-bold text-[var(--ink)]">
                Discuter avec {who.name}
              </b>
              <button
                type="button"
                onClick={() => setShowChat(false)}
                aria-label="Fermer"
                className="grid size-8 place-items-center rounded-full bg-[var(--soft)]"
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
