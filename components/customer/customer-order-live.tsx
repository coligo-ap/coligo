"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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

type PopupTpl = {
  titleKey: string;
  bodyKey: string;
  tone: "success" | "danger";
};

const STATUS_POPUP: Partial<Record<OrderStatus, PopupTpl>> = {
  accepted: {
    titleKey: "popupAcceptedTitle",
    bodyKey: "popupAcceptedBody",
    tone: "success",
  },
  preparing: {
    titleKey: "popupAcceptedTitle",
    bodyKey: "popupAcceptedBody",
    tone: "success",
  },
  ready: {
    titleKey: "popupReadyTitle",
    bodyKey: "popupReadyBody",
    tone: "success",
  },
  cancelled: {
    titleKey: "popupRefusedTitle",
    bodyKey: "popupRefusedBody",
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
  const t = useTranslations("orders");
  const router = useRouter();
  const lastStatusRef = useRef<OrderStatus>(initialStatus);
  const [popup, setPopup] = useState<Popup | null>(null);
  const { unlock, play } = useAlertSound();
  // Réf stable vers la logique de transition (évite de re-souscrire/re-poller).
  const onStatusRef = useRef<
    (next: OrderStatus, cancelledBy?: string | null) => void
  >(() => {});

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
  //
  // `cancelledBy` distingue l'origine d'une annulation : si c'est le CLIENT
  // lui-même qui a annulé (cancelled_by='customer'), on NE montre PAS le pop-up
  // « Commande refusée » (il vient de l'annuler et a déjà eu sa confirmation) —
  // ce message ne concerne que les refus commerçant / auto-refus (15 min).
  onStatusRef.current = (next: OrderStatus, cancelledBy?: string | null) => {
    if (next === lastStatusRef.current) return;
    lastStatusRef.current = next;
    const tmpl =
      next === "cancelled" && cancelledBy === "customer"
        ? undefined
        : STATUS_POPUP[next];
    if (tmpl) {
      const title = t(tmpl.titleKey);
      const body = t(tmpl.bodyKey);
      setPopup({ title, body, tone: tmpl.tone });
      try {
        void play();
      } catch {
        /* audio verrouillé : pop-up + vibration suffisent */
      }
      vibrate([200, 100, 200]);
      try {
        notify(title, { body, tag: `order-${orderId}` });
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
          const row = payload.new as {
            status: OrderStatus;
            cancelled_by?: string | null;
          };
          onStatusRef.current(row.status, row.cancelled_by ?? null);
        }
      )
      .subscribe();

    const poll = async () => {
      // `cancelled_by` n'est pas (encore) dans database.types.ts généré → on
      // cast le résultat localement (la colonne existe bien côté DB, mig 0073).
      const { data } = (await supabase
        .from("orders")
        .select("status, cancelled_by")
        .eq("id", orderId)
        .maybeSingle()) as unknown as {
        data: { status: OrderStatus; cancelled_by: string | null } | null;
      };
      if (data?.status) onStatusRef.current(data.status, data.cancelled_by);
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
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center"
      onClick={() => setPopup(null)}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl"
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
            "mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white " +
            (isOk
              ? "bg-success-600 hover:bg-success-700"
              : "bg-primary-600 hover:bg-primary-700")
          }
        >
          <CheckCircle2 className="size-4" />
          {t("understood")}
        </button>
      </div>
    </div>
  );
}
