"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Loader2,
  MapPin,
  Package,
  Phone,
  Route,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { formatDA } from "@/lib/utils";
import {
  markDeliveryArrived,
  markTourPickedUp,
  reorderTourFromPosition,
} from "@/app/(driver)/actions";
import { getPosition } from "@/lib/native/geolocation";
import { DeliveryValidationDialog } from "./delivery-validation-dialog";
import { DeliveryRouteMap } from "./delivery-route-map";
import { DriverLocationBroadcaster } from "./driver-location-broadcaster";

type Stop = {
  stop_id: string;
  stop_order: number;
  stop_status: "pending" | "delivered" | "failed";
  order_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  total_da: number | null;
  payment_method: "cash" | "online";
  delivery_address_text: string | null;
  delivery_phone: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  delivery_note: string | null;
  delivery_picked_up_at: string | null;
  delivery_arrived_at: string | null;
};

export function TourExecution({
  stops,
  tourId,
}: {
  stops: Stop[];
  tourId: string;
}) {
  const router = useRouter();
  const [validateFor, setValidateFor] = useState<Stop | null>(null);
  const [pending, start] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(
    stops.find((s) => s.stop_status === "pending")?.stop_id ?? null
  );

  const allPickedUp = stops.every(
    (s) => s.stop_status !== "pending" || s.delivery_picked_up_at != null
  );

  // Stop en cours = premier arrêt non livré déjà récupéré → on diffuse la
  // position du livreur au client de cette commande.
  const currentStop = stops.find(
    (s) => s.stop_status === "pending" && s.delivery_picked_up_at != null
  );

  const onBulkPickup = () =>
    start(async () => {
      const r = await markTourPickedUp(tourId);
      if (!r.ok) {
        toast.error(r.error ?? "Erreur");
        return;
      }
      toast.success(
        `${r.count} commande${(r.count ?? 0) > 1 ? "s" : ""} récupérée${
          (r.count ?? 0) > 1 ? "s" : ""
        } — bonne tournée !`
      );
      router.refresh();
    });

  const onArrived = (orderId: string) =>
    start(async () => {
      const r = await markDeliveryArrived(orderId);
      if (!r.ok) {
        toast.error(r.reason ?? "Erreur");
        return;
      }
      toast.success("Arrivée signalée au client");
      router.refresh();
    });

  const onReorder = () =>
    start(async () => {
      try {
        const pos = await getPosition();
        const r = await reorderTourFromPosition(
          tourId,
          pos.latitude,
          pos.longitude
        );
        if (!r.ok) {
          toast.error(r.error ?? "Erreur");
          return;
        }
        toast.success(`Itinéraire ré-optimisé (${r.reordered ?? 0} arrêts)`);
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Position GPS indisponible pour ré-optimiser"
        );
      }
    });

  return (
    <div className="space-y-4">
      {currentStop && (
        <DriverLocationBroadcaster orderId={currentStop.order_id} />
      )}
      <div className="bg-primary-50 border-primary-200 flex flex-wrap items-center gap-2 rounded-[12px] border p-3">
        {!allPickedUp ? (
          <Button
            type="button"
            size="sm"
            onClick={onBulkPickup}
            disabled={pending}
            className="flex-1"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Package className="size-4" />
            )}
            J&apos;ai chargé toutes les commandes
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onReorder}
            disabled={pending}
            className="flex-1"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Route className="size-4" />
            )}
            Re-optimiser depuis ma position
          </Button>
        )}
      </div>

      <ol className="space-y-3">
        {stops.map((s) => {
          const done = s.stop_status === "delivered";
          const expanded = expandedId === s.stop_id;
          return (
            <li
              key={s.stop_id}
              className={
                "border-border bg-surface space-y-2 rounded-[14px] border p-4 " +
                (done ? "opacity-70" : "")
              }
            >
              <header
                className="flex cursor-pointer items-center justify-between gap-2"
                onClick={() => setExpandedId(expanded ? null : s.stop_id)}
              >
                <div className="flex items-center gap-2">
                  <span className="bg-primary-100 text-primary-700 inline-flex size-7 items-center justify-center rounded-full text-xs font-bold tabular-nums">
                    {s.stop_order}
                  </span>
                  <div>
                    <p className="text-sm font-semibold">
                      {s.customer_name ?? "Client"}
                    </p>
                    <p className="text-muted text-xs">
                      {s.payment_method === "online" ? "Payé en ligne" : "Cash"}{" "}
                      · {s.total_da != null ? formatDA(s.total_da) : "—"}
                    </p>
                  </div>
                </div>
                {done ? (
                  <span className="text-success-700 inline-flex items-center gap-1 text-xs font-semibold">
                    <Check className="size-3.5" /> Livré
                  </span>
                ) : (
                  <span className="text-muted text-xs">
                    {expanded ? "▼" : "▶"}
                  </span>
                )}
              </header>

              {expanded && !done && (
                <div className="space-y-2 pt-1">
                  {s.delivery_address_text && (
                    <p className="text-muted flex items-start gap-1.5 text-xs">
                      <MapPin className="mt-0.5 size-3.5 shrink-0" />
                      {s.delivery_address_text}
                    </p>
                  )}
                  {(s.delivery_phone ?? s.customer_phone) && (
                    <a
                      href={`tel:${s.delivery_phone ?? s.customer_phone}`}
                      className="text-primary-700 inline-flex items-center gap-1.5 text-xs underline"
                    >
                      <Phone className="size-3.5" />
                      {s.delivery_phone ?? s.customer_phone}
                    </a>
                  )}
                  {s.delivery_note && (
                    <p className="border-warning-200 bg-warning-50 text-warning-800 flex items-start gap-1.5 rounded-[8px] border px-2 py-1.5 text-xs">
                      <StickyNote className="mt-0.5 size-3.5 shrink-0" />
                      {s.delivery_note}
                    </p>
                  )}

                  {s.delivery_lat != null && s.delivery_lng != null && (
                    <DeliveryRouteMap
                      target={{ lat: s.delivery_lat, lng: s.delivery_lng }}
                      label="Vers le client (livraison)"
                      height={180}
                    />
                  )}

                  {/* Étape : signaler l'arrivée (visible côté client) puis valider. */}
                  {s.delivery_picked_up_at != null &&
                    s.delivery_arrived_at == null && (
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
                        onClick={() => onArrived(s.order_id)}
                        disabled={pending}
                      >
                        {pending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <MapPin className="size-4" />
                        )}
                        Je suis arrivé chez le client
                      </Button>
                    )}

                  {(s.delivery_arrived_at != null ||
                    s.delivery_picked_up_at == null) && (
                    <Button
                      type="button"
                      className="w-full"
                      onClick={() => setValidateFor(s)}
                    >
                      Marquer livré ✓
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {validateFor && (
        <DeliveryValidationDialog
          orderId={validateFor.order_id}
          paymentMethod={validateFor.payment_method}
          onClose={() => setValidateFor(null)}
          onSuccess={() => {
            const nextPending = stops.find(
              (x) =>
                x.stop_id !== validateFor.stop_id && x.stop_status === "pending"
            );
            setValidateFor(null);
            if (nextPending) setExpandedId(nextPending.stop_id);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
