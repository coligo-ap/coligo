"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { toast } from "@/components/ui/toast";
import {
  declineExpress,
  confirmArrival,
  markOrderPickedUp,
} from "@/app/(driver)/actions";
import { getPosition } from "@/lib/native/geolocation";
import { DeliveryValidationDialog } from "./delivery-validation-dialog";
import { PostDeliveryFeedback } from "./post-delivery-feedback";
import { DriverLocationBroadcaster } from "./driver-location-broadcaster";
import { ChevronDown, LifeBuoy } from "lucide-react";
import { openSupportChat } from "@/components/support/tawk-chat";
import { ExpressOffer } from "./express-offer";
import { ExpressRun } from "./course/express-run";
import type { DriverFeeConfig } from "@/lib/driver/settlement";
import {
  setActiveCourse,
  clearActiveCourse,
} from "@/lib/driver/active-course-store";
import { markSelfValidated } from "./driver-cancel-watch";

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
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
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
    toast.success(
      tr("Course acceptée — en route", "تم قبول التوصيلة — في الطريق")
    );
  };

  const refuseOffer = () => {
    if (!currentOrder) return;
    start(async () => {
      const r = await declineExpress(currentOrder.id);
      if (!r.ok) {
        toast.error(
          r.reason === "already_picked_up"
            ? tr(
                "Trop tard : commande déjà récupérée.",
                "فات الأوان: الطلب تم استلامه."
              )
            : tr(
                "Impossible de refuser cette course.",
                "تعذّر رفض هذه التوصيلة."
              )
        );
        return;
      }
      // La course repart automatiquement vers un autre livreur en ligne.
      clearActiveCourse();
      toast.success(
        tr(
          "Course refusée — proposée à un autre livreur",
          "تم رفض التوصيلة — عُرضت على سائق آخر"
        )
      );
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
        toast.error(r.reason ?? tr("Erreur", "خطأ"));
        return;
      }
      toast.success(
        tr(
          "Commande récupérée — en route vers le client",
          "تم استلام الطلب — في الطريق إلى الزبون"
        )
      );
      router.refresh();
    });
  };

  // Arrivée GÉO-CLÔTURÉE (mig 0329) : on doit être à quelques mètres de
  // l'adresse exacte pour démarrer le minuteur d'attente (anti-fraude no-show).
  const onArrived = () => {
    if (!currentOrder) return;
    start(async () => {
      let pos: { latitude: number; longitude: number };
      try {
        pos = await getPosition();
      } catch {
        toast.error(
          tr(
            "Active la localisation pour confirmer ton arrivée.",
            "فعّل تحديد الموقع لتأكيد وصولك."
          )
        );
        return;
      }
      const r = await confirmArrival({
        orderId: currentOrder.id,
        lat: pos.latitude,
        lng: pos.longitude,
      });
      if (!r.ok) {
        toast.error(
          r.reason === "too_far"
            ? tr(
                "Tu es trop loin de l'adresse du client. Rapproche-toi pour confirmer.",
                "أنت بعيد عن عنوان الزبون. اقترب للتأكيد."
              )
            : r.reason === "no_location"
              ? tr(
                  "Adresse client sans position GPS — contacte le support.",
                  "عنوان الزبون بدون موقع — تواصل مع الدعم."
                )
              : (r.reason ?? tr("Erreur", "خطأ"))
        );
        return;
      }
      toast.success(tr("Arrivée signalée au client", "تم إشعار الزبون بوصولك"));
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
            {tr("Réduire", "تصغير")}
          </button>
          {/* Support en cours de course (Tawk.to) — n° commande injecté. */}
          <button
            type="button"
            onClick={() =>
              openSupportChat({
                orderRef: currentOrder.order_number,
                // Course Express EN COURS → prioritaire (le livreur est bloqué
                // sur le terrain) : remonté en URGENT côté support.
                priority: "urgent",
                subject: "Course Express en cours",
                attributes: {
                  Boutique: merchantName,
                  Étape: pickedUp ? "Vers le client" : "Vers le commerçant",
                  Client: currentOrder.customer_name ?? undefined,
                  "Tél client": currentOrder.delivery_phone ?? undefined,
                  Adresse: currentOrder.delivery_address_text ?? undefined,
                  Paiement:
                    currentOrder.payment_method === "cash"
                      ? "Espèces"
                      : "En ligne",
                  Montant:
                    currentOrder.total_da != null
                      ? `${currentOrder.total_da} DA`
                      : undefined,
                },
              })
            }
            className="fixed top-[max(14px,calc(env(safe-area-inset-top)+10px))] left-3 z-[95] inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur"
          >
            <LifeBuoy className="size-4" />
            {tr("Aide", "مساعدة")}
          </button>
        </>
      )}

      <section className="space-y-3 rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <header className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-full bg-[var(--soft)] text-sm">
            ⚡
          </span>
          <p className="text-sm font-bold text-[var(--ink)]">
            {tr("Livraison Express", "توصيل سريع")}
          </p>
        </header>

        {currentOrder ? (
          <p className="text-xs font-medium text-[var(--muted)]">
            {tr(
              "Course en cours — suis les étapes sur l'écran plein.",
              "توصيلة جارية — اتبع الخطوات على الشاشة الكاملة."
            )}
          </p>
        ) : (
          <p className="text-xs font-medium text-[var(--muted)]">
            {tr(
              "Aucune course Express ici. Passe en ligne depuis l'accueil : les courses proches arrivent automatiquement, où que tu sois dans l'app.",
              "لا توجد توصيلة سريعة هنا. اتصل من الصفحة الرئيسية: تصلك التوصيلات القريبة تلقائياً أينما كنت في التطبيق."
            )}
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
              // Validation par le LIVREUR lui-même : le watch global ne doit
              // pas afficher « clôturée par la plateforme » sur cette action.
              markSelfValidated(currentOrder.id);
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
