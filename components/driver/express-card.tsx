"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import {
  declineExpress,
  markDeliveryArrived,
  markOrderPickedUp,
} from "@/app/(driver)/actions";
import { DeliveryValidationDialog } from "./delivery-validation-dialog";
import { PostDeliveryFeedback } from "./post-delivery-feedback";
import { DriverLocationBroadcaster } from "./driver-location-broadcaster";
import { ChevronDown } from "lucide-react";
import { ExpressOffer } from "./express-offer";
import { ExpressRun } from "./course/express-run";
import type { DriverFeeConfig } from "@/lib/driver/settlement";
import {
  setActiveCourse,
  clearActiveCourse,
} from "@/lib/driver/active-course-store";

const ACCEPTED_KEY = "coligo_driver_accepted_orders";

type CurrentOrder = {
  id: string;
  order_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  total_da: number | null;
  delivery_fee_da: number | null;
  payment_method: "cash" | "online";
  delivery_address_text: string | null;
  delivery_phone: string | null;
  delivery_recipient_name: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  delivery_note: string | null;
  delivery_picked_up_at: string | null;
  delivery_arrived_at: string | null;
  status: string;
  delivery_mode: "express" | "tour" | null;
};

/**
 * Carte Express d'un espace commerçant. La RÉCEPTION des courses Express est
 * désormais GLOBALE (dispatch par zone monté dans le layout livreur, piloté par
 * l'intention « en ligne ») — plus aucun pull ni inscription par commerçant ici.
 * Ce composant ne gère plus que le DÉROULÉ d'une course déjà attribuée :
 * offre plein écran (qui sonne) → course en cours → validation → retour.
 */
export function ExpressCard({
  currentOrder,
  itemCount,
  merchantName,
  merchantLat,
  merchantLng,
  driverFeeConfig,
}: {
  currentOrder: CurrentOrder | null;
  itemCount: number;
  merchantName: string;
  merchantLat?: number | null;
  merchantLng?: number | null;
  driverFeeConfig?: DriverFeeConfig;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showValidate, setShowValidate] = useState(false);
  // Retour post-livraison (noter + signaler le client) une fois validée.
  const [feedbackOrder, setFeedbackOrder] = useState<{
    id: string;
    name: string | null;
  } | null>(null);
  // Offre acceptée (écran 2 → écran 3). L'attribution ayant déjà eu lieu côté
  // serveur, on garde le « consentement » du livreur côté client pour ne pas
  // ré-afficher l'offre plein écran après acceptation / reload.
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
      // La course repart automatiquement vers un autre livreur en ligne.
      clearActiveCourse();
      toast.success("Course refusée — proposée à un autre livreur");
      router.push("/driver");
    });
  };

  const pickedUp = !!currentOrder?.delivery_picked_up_at;
  const arrived = !!currentOrder?.delivery_arrived_at;
  // Écran 2 : offre plein écran tant que la commande fraîchement attribuée
  // n'est ni acceptée ni récupérée.
  const showOffer = !!currentOrder && !pickedUp && !accepted;
  // Écran 3 : course en cours plein écran une fois l'offre acceptée (ou si la
  // commande est déjà récupérée — ex. reload en pleine course).
  const showRun = !!currentOrder && !showOffer;

  // Pose/maintient la course active dans le store global (pour le bandeau
  // réductible inter-onglets) tant que la course tourne ; la retire sinon.
  useEffect(() => {
    if (showRun && currentOrder) {
      setActiveCourse({
        orderId: currentOrder.id,
        merchantName,
        step: pickedUp ? "dropoff" : "pickup",
      });
    }
  }, [showRun, currentOrder, merchantName, pickedUp]);

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

  return (
    <>
      {showOffer && currentOrder && (
        <ExpressOffer
          order={currentOrder}
          merchantName={merchantName}
          merchantLat={merchantLat}
          merchantLng={merchantLng}
          onAccept={acceptOffer}
          onRefuse={refuseOffer}
          onTimeout={refuseOffer}
          refusing={pending}
          driverFeeConfig={driverFeeConfig}
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
          {/* Réduire la navigation → revient sur un onglet ; le bandeau
              « Course en cours » reste épinglé au-dessus de la tabbar. */}
          <button
            type="button"
            onClick={() => router.push("/driver")}
            className="fixed top-[max(14px,calc(env(safe-area-inset-top)+10px))] right-3 z-[95] inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur"
          >
            <ChevronDown className="size-4" />
            Réduire
          </button>
        </>
      )}

      <section className="space-y-3 rounded-[14px] bg-white p-4 shadow-[0_4px_16px_rgba(0,0,0,.06)]">
        <header className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-full bg-[#f5f5f5] text-sm">
            ⚡
          </span>
          <p className="text-sm font-bold text-[#0a0a0a]">Livraison Express</p>
        </header>

        {currentOrder ? (
          <p className="text-xs font-medium text-[#757575]">
            Course en cours — suis les étapes sur l&apos;écran plein.
          </p>
        ) : (
          <p className="text-xs font-medium text-[#757575]">
            Aucune course Express ici. Passe en ligne depuis l&apos;accueil :
            les courses proches arrivent automatiquement, où que tu sois dans
            l&apos;app.
          </p>
        )}

        {showValidate && currentOrder && (
          <DeliveryValidationDialog
            orderId={currentOrder.id}
            orderNumber={currentOrder.order_number}
            paymentMethod={currentOrder.payment_method}
            customerName={currentOrder.customer_name}
            totalDa={currentOrder.total_da}
            arrivedAt={currentOrder.delivery_arrived_at}
            onClose={() => setShowValidate(false)}
            onSuccess={() => {
              setShowValidate(false);
              // Affiche le retour post-livraison (note + signalement).
              setFeedbackOrder({
                id: currentOrder.id,
                name: currentOrder.customer_name,
              });
              router.refresh();
            }}
          />
        )}
      </section>

      {feedbackOrder && (
        <PostDeliveryFeedback
          orderId={feedbackOrder.id}
          customerName={feedbackOrder.name}
          onDone={() => {
            setFeedbackOrder(null);
            clearActiveCourse();
            // La prochaine course arrive via le dispatch global (réception en
            // ligne) — on renvoie le livreur à l'accueil.
            router.push("/driver");
          }}
        />
      )}
    </>
  );
}
