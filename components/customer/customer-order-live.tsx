"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, PartyPopper, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAlertSound, vibrate } from "@/lib/hooks/use-alert-sound";
import { notify } from "@/lib/native";
import type { OrderStatus } from "@/lib/types";

/**
 * S'abonne en temps réel aux changements de SA commande (Realtime). Quand le
 * commerçant accepte / refuse / prépare / rend prête la commande, le client est
 * notifié IMMÉDIATEMENT, où qu'il soit sur la page : son d'alerte + vibration +
 * notification système (si l'app le permet) + POP-UP plein écran. La page est
 * aussi rafraîchie pour refléter le nouveau statut.
 *
 * (Le push FCM hors-app est géré côté serveur dans `notifyCustomerStatusChange`,
 * déclenché par `updateOrderStatus`. Ici on couvre le cas app ouverte.)
 */

type Popup = {
  title: string;
  body: string;
  tone: "success" | "danger";
};

const STATUS_POPUP: Partial<Record<OrderStatus, Popup>> = {
  accepted: {
    title: "Commande acceptée 🎉",
    body: "Le commerçant prépare votre commande.",
    tone: "success",
  },
  preparing: {
    title: "Commande acceptée 🎉",
    body: "Le commerçant prépare votre commande.",
    tone: "success",
  },
  ready: {
    title: "Commande prête ✅",
    body: "Vous pouvez aller la récupérer.",
    tone: "success",
  },
  cancelled: {
    title: "Commande refusée",
    body: "Le commerçant n'a pas pu accepter votre commande.",
    tone: "danger",
  },
};

export function CustomerOrderLive({
  orderId,
  initialStatus,
}: {
  orderId: string;
  initialStatus: OrderStatus;
}) {
  const router = useRouter();
  const lastStatusRef = useRef<OrderStatus>(initialStatus);
  const [popup, setPopup] = useState<Popup | null>(null);
  const { unlock, play } = useAlertSound();
  // Réf stable vers la logique de transition (évite de re-souscrire/re-poller).
  const onStatusRef = useRef<(next: OrderStatus) => void>(() => {});

  // Déverrouille l'audio au 1er geste utilisateur (autoplay bloqué sinon).
  useEffect(() => {
    let done = false;
    const handler = () => {
      if (done) return;
      done = true;
      void unlock();
      window.removeEventListener("pointerup", handler);
      window.removeEventListener("keydown", handler);
    };
    window.addEventListener("pointerup", handler);
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("pointerup", handler);
      window.removeEventListener("keydown", handler);
    };
  }, [unlock]);

  // Réagit à un (nouveau) statut : pop-up + son + vibration + notif système,
  // puis refresh. Idempotent (ignore si statut inchangé).
  onStatusRef.current = (next: OrderStatus) => {
    if (next === lastStatusRef.current) return;
    lastStatusRef.current = next;
    const tmpl = STATUS_POPUP[next];
    if (tmpl) {
      setPopup(tmpl);
      try {
        void play();
      } catch {
        /* audio verrouillé : pop-up + vibration suffisent */
      }
      vibrate([200, 100, 200]);
      try {
        notify(tmpl.title, { body: tmpl.body, tag: `order-${orderId}` });
      } catch {
        /* ignoré */
      }
    }
    router.refresh();
  };

  // Realtime (instantané) + polling actif (filet si le Realtime ne livre pas) :
  // le client est notifié de l'acceptation / refus quoi qu'il arrive.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`customer-order-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `id=eq.${orderId}`,
        },
        (payload) => {
          onStatusRef.current((payload.new as { status: OrderStatus }).status);
        }
      )
      .subscribe();

    const poll = async () => {
      const { data } = await supabase
        .from("orders")
        .select("status")
        .eq("id", orderId)
        .maybeSingle();
      if (data?.status) onStatusRef.current(data.status as OrderStatus);
    };
    const interval = setInterval(() => void poll(), 6000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [orderId]);

  if (!popup) return null;

  const isOk = popup.tone === "success";
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={() => setPopup(null)}
    >
      <div
        className="w-full max-w-sm rounded-[20px] bg-white p-6 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={
            "mx-auto mb-3 flex size-14 items-center justify-center rounded-full " +
            (isOk
              ? "bg-success-50 text-success-600"
              : "bg-danger-50 text-danger-600")
          }
        >
          {isOk ? (
            <PartyPopper className="size-7" />
          ) : (
            <XCircle className="size-7" />
          )}
        </div>
        <h2 className="text-lg font-bold">{popup.title}</h2>
        <p className="text-muted mt-1 text-sm">{popup.body}</p>
        <button
          type="button"
          onClick={() => setPopup(null)}
          className={
            "mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] px-4 text-sm font-semibold text-white " +
            (isOk
              ? "bg-success-600 hover:bg-success-700"
              : "bg-primary-600 hover:bg-primary-700")
          }
        >
          <CheckCircle2 className="size-4" />
          J&apos;ai compris
        </button>
      </div>
    </div>
  );
}
