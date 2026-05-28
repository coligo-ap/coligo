"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Bolt,
  Check,
  Loader2,
  MapPin,
  Package,
  Phone,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { formatDA } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { markOrderPickedUp, pullNextExpress } from "@/app/(driver)/actions";
import { AvailabilityToggle } from "./availability-toggle";
import { DeliveryValidationDialog } from "./delivery-validation-dialog";
import { DeliveryRouteMap } from "./delivery-route-map";
import { DriverLocationBroadcaster } from "./driver-location-broadcaster";

type CurrentOrder = {
  id: string;
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
  status: string;
  delivery_mode: "express" | "tour" | null;
};

export function ExpressCard({
  merchantDriverId,
  availStatus,
  currentOrder,
  merchantName,
}: {
  merchantDriverId: string;
  availStatus: "offline" | "available" | "busy";
  currentOrder: CurrentOrder | null;
  merchantName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showValidate, setShowValidate] = useState(false);

  // Realtime : si on est dispo et qu'une nouvelle commande express arrive,
  // on tente de la puller (le serveur fait FIFO + skip locked).
  const onChange = useCallback(() => {
    if (availStatus !== "available") return;
    start(async () => {
      const r = await pullNextExpress(merchantDriverId);
      if (r.orderId) {
        toast.success("Commande attribuée !");
        router.refresh();
      }
    });
  }, [availStatus, merchantDriverId, router]);

  useEffect(() => {
    if (availStatus !== "available") return;
    const supabase = createClient();
    const channel = supabase
      .channel(`driver-express-${merchantDriverId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "orders",
          filter: `delivery_mode=eq.express`,
        },
        onChange
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `delivery_mode=eq.express`,
        },
        onChange
      )
      .subscribe();

    onChange();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [availStatus, merchantDriverId, onChange]);

  const pickedUp = !!currentOrder?.delivery_picked_up_at;

  const onPickup = () => {
    if (!currentOrder) return;
    start(async () => {
      const r = await markOrderPickedUp(currentOrder.id);
      if (!r.ok) {
        toast.error(r.reason ?? "Erreur");
        return;
      }
      toast.success("Commande récupérée — en route vers le client");
      router.refresh();
    });
  };

  const onNext = () => {
    start(async () => {
      const r = await pullNextExpress(merchantDriverId);
      if (r.orderId) {
        toast.success("Nouvelle commande attribuée !");
        router.refresh();
      } else {
        toast.success("Pas d'autre commande en attente — tu es libre.");
      }
    });
  };

  return (
    <section className="border-border bg-surface space-y-3 rounded-[14px] border p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bolt className="text-warning-500 size-5" />
          <p className="text-sm font-semibold">Livraison Express</p>
        </div>
        <AvailabilityToggle
          merchantDriverId={merchantDriverId}
          status={availStatus}
        />
      </header>

      {currentOrder ? (
        <div className="border-primary-200 bg-primary-50 space-y-3 rounded-[12px] border p-3">
          {/* Étape 1 : Récupérer chez le commerçant */}
          {!pickedUp && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="bg-warning-500 inline-flex size-6 items-center justify-center rounded-full text-xs font-bold text-white">
                  1
                </span>
                <p className="text-sm font-semibold">
                  Va chercher la commande chez {merchantName}
                </p>
              </div>
              <p className="text-muted text-xs">
                Une fois en main, clique pour démarrer la livraison.
              </p>
              <Button
                type="button"
                className="w-full"
                onClick={onPickup}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Package className="size-4" />
                )}
                J&apos;ai récupéré la commande
              </Button>
            </div>
          )}

          {/* Étape 2 : Aller chez le client + livrer */}
          {pickedUp && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="bg-success-600 inline-flex size-6 items-center justify-center rounded-full text-xs font-bold text-white">
                  <Check className="size-3" />
                </span>
                <p className="text-success-700 text-xs font-semibold tracking-wide uppercase">
                  Récupéré · en route vers le client
                </p>
              </div>
            </div>
          )}

          {/* Bloc client + carte (visible en permanence, le livreur a besoin
              de voir où il va même avant le pickup pour préparer). */}
          <div className="border-primary-200 space-y-2 border-t pt-3">
            <p className="text-sm font-semibold">
              {currentOrder.customer_name ?? "Client"} ·{" "}
              {currentOrder.total_da != null
                ? formatDA(currentOrder.total_da)
                : "—"}
            </p>
            <p className="text-xs tracking-wide uppercase">
              Paiement :{" "}
              <strong>
                {currentOrder.payment_method === "online"
                  ? "En ligne (payé)"
                  : "Cash à encaisser"}
              </strong>
            </p>
            {currentOrder.delivery_address_text && (
              <p className="text-muted flex items-start gap-1.5 text-xs">
                <MapPin className="mt-0.5 size-3.5 shrink-0" />
                {currentOrder.delivery_address_text}
              </p>
            )}
            {(currentOrder.delivery_phone ?? currentOrder.customer_phone) && (
              <a
                href={`tel:${currentOrder.delivery_phone ?? currentOrder.customer_phone}`}
                className="text-primary-700 inline-flex items-center gap-1.5 text-xs underline"
              >
                <Phone className="size-3.5" />
                {currentOrder.delivery_phone ?? currentOrder.customer_phone}
              </a>
            )}
            {currentOrder.delivery_note && (
              <p className="border-warning-200 bg-warning-50 text-warning-800 flex items-start gap-1.5 rounded-[8px] border px-2 py-1.5 text-xs">
                <StickyNote className="mt-0.5 size-3.5 shrink-0" />
                {currentOrder.delivery_note}
              </p>
            )}
          </div>

          {/* Carte route (uniquement si on a la cible géolocalisée) */}
          {currentOrder.delivery_lat != null &&
            currentOrder.delivery_lng != null && (
              <DeliveryRouteMap
                target={{
                  lat: currentOrder.delivery_lat,
                  lng: currentOrder.delivery_lng,
                }}
              />
            )}

          {/* Tant que la commande est récupérée (en route), on diffuse la
              position GPS au client pour le suivi live. */}
          {pickedUp && <DriverLocationBroadcaster orderId={currentOrder.id} />}

          {pickedUp && (
            <Button
              type="button"
              className="w-full"
              onClick={() => setShowValidate(true)}
            >
              Marquer livré ✓
            </Button>
          )}
        </div>
      ) : availStatus === "available" ? (
        <div className="space-y-2">
          <p className="text-muted flex items-center gap-2 text-xs">
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            En attente d&apos;une commande Express…
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onNext}
            disabled={pending}
            className="w-full"
          >
            Vérifier maintenant
          </Button>
        </div>
      ) : (
        <p className="text-muted text-xs">
          Bascule sur « Disponible » pour recevoir des commandes Express.
        </p>
      )}

      {showValidate && currentOrder && (
        <DeliveryValidationDialog
          orderId={currentOrder.id}
          paymentMethod={currentOrder.payment_method}
          onClose={() => setShowValidate(false)}
          onSuccess={() => {
            setShowValidate(false);
            router.refresh();
            // Auto-propose la suivante après 1.5 s.
            setTimeout(() => {
              start(async () => {
                const r = await pullNextExpress(merchantDriverId);
                if (r.orderId) {
                  toast.success("Une nouvelle commande t'attend !");
                  router.refresh();
                }
              });
            }, 1500);
          }}
        />
      )}
    </section>
  );
}
