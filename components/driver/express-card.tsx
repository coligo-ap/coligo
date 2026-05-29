"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bolt, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import {
  declineExpress,
  markDeliveryArrived,
  markOrderPickedUp,
  pullNextExpress,
} from "@/app/(driver)/actions";
import { AvailabilityToggle } from "./availability-toggle";
import { DeliveryValidationDialog } from "./delivery-validation-dialog";
import { DriverLocationBroadcaster } from "./driver-location-broadcaster";
import { ExpressOffer } from "./express-offer";
import { ExpressRun } from "./course/express-run";

const ACCEPTED_KEY = "coligo_driver_accepted_orders";

type CurrentOrder = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  total_da: number | null;
  delivery_fee_da: number | null;
  payment_method: "cash" | "online";
  delivery_address_text: string | null;
  delivery_phone: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  delivery_note: string | null;
  delivery_picked_up_at: string | null;
  delivery_arrived_at: string | null;
  status: string;
  delivery_mode: "express" | "tour" | null;
};

export function ExpressCard({
  merchantDriverId,
  availStatus,
  currentOrder,
  itemCount,
  merchantName,
  merchantLat,
  merchantLng,
}: {
  merchantDriverId: string;
  availStatus: "offline" | "available" | "busy";
  currentOrder: CurrentOrder | null;
  itemCount: number;
  merchantName: string;
  merchantLat?: number | null;
  merchantLng?: number | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showValidate, setShowValidate] = useState(false);
  // Offre acceptée (écran 2 → écran 3). L'attribution FIFO ayant déjà eu lieu
  // côté serveur, on garde le « consentement » du livreur côté client pour ne
  // pas ré-afficher l'offre plein écran après acceptation / reload.
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!currentOrder) {
      setAccepted(false);
      return;
    }
    try {
      const raw = localStorage.getItem(ACCEPTED_KEY);
      const set = raw ? (JSON.parse(raw) as string[]) : [];
      setAccepted(set.includes(currentOrder.id));
    } catch {
      setAccepted(false);
    }
  }, [currentOrder]);

  const acceptOffer = () => {
    if (!currentOrder) return;
    try {
      const raw = localStorage.getItem(ACCEPTED_KEY);
      const set = raw ? (JSON.parse(raw) as string[]) : [];
      if (!set.includes(currentOrder.id)) set.push(currentOrder.id);
      localStorage.setItem(ACCEPTED_KEY, JSON.stringify(set.slice(-20)));
    } catch {
      /* localStorage indispo → on accepte quand même en mémoire */
    }
    setAccepted(true);
    toast.success("Course acceptée — en route");
  };

  const refuseOffer = () => {
    if (!currentOrder) return;
    start(async () => {
      const r = await declineExpress(currentOrder.id);
      if (!r.ok) {
        toast.error(
          r.reason === "already_picked_up"
            ? "Trop tard : commande déjà récupérée."
            : "Impossible de refuser cette course."
        );
        return;
      }
      toast.success("Course refusée");
      router.refresh();
    });
  };

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
  const arrived = !!currentOrder?.delivery_arrived_at;
  // Écran 2 : offre plein écran tant que la commande fraîchement attribuée
  // n'est ni acceptée ni récupérée.
  const showOffer = !!currentOrder && !pickedUp && !accepted;
  // Écran 3 : course en cours plein écran une fois l'offre acceptée (ou si la
  // commande est déjà récupérée — ex. reload en pleine course).
  const showRun = !!currentOrder && !showOffer;

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

  const onArrived = () => {
    if (!currentOrder) return;
    start(async () => {
      const r = await markDeliveryArrived(currentOrder.id);
      if (!r.ok) {
        toast.error(r.reason ?? "Erreur");
        return;
      }
      toast.success("Arrivée signalée au client");
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
    <>
      {showOffer && currentOrder && (
        <ExpressOffer
          order={currentOrder}
          itemCount={itemCount}
          merchantName={merchantName}
          merchantLat={merchantLat}
          merchantLng={merchantLng}
          onAccept={acceptOffer}
          onRefuse={refuseOffer}
          refusing={pending}
        />
      )}

      {/* Écran 3 — course en cours, plein écran. Pendant la course (récupérée),
          on diffuse aussi la position GPS au client pour le suivi live. */}
      {showRun && currentOrder && (
        <>
          <ExpressRun
            order={currentOrder}
            itemCount={itemCount}
            merchantName={merchantName}
            merchantLat={merchantLat}
            merchantLng={merchantLng}
            pickedUp={pickedUp}
            arrived={arrived}
            pending={pending}
            onPickup={onPickup}
            onArrived={onArrived}
            onValidate={() => setShowValidate(true)}
          />
          {pickedUp && <DriverLocationBroadcaster orderId={currentOrder.id} />}
        </>
      )}

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
          <p className="text-muted text-xs">
            Course en cours — suis les étapes sur l&apos;écran plein.
          </p>
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
            customerName={currentOrder.customer_name}
            totalDa={currentOrder.total_da}
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
    </>
  );
}
