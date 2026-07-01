"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  useActiveCourse,
  clearActiveCourse,
} from "@/lib/driver/active-course-store";
import { playAlert } from "@/lib/driver/sounds";

/**
 * DriverCancelWatch — STOP temps réel d'une course annulée.
 *
 * Quand le commerçant ou le super-admin annule une commande que le livreur a
 * DÉJÀ ACCEPTÉE (avant récupération), le serveur libère le livreur + envoie un
 * push (`notifyDriverOrderCancelled`). Ce composant, monté GLOBALEMENT dans le
 * layout livreur, écoute en plus la commande active en Realtime : dès qu'elle
 * passe à `cancelled`, il COUPE la course (clearActiveCourse) et affiche un
 * pop-up bloquant « Commande annulée ». L'app reste cohérente même si le push
 * n'arrive pas (app au premier plan).
 *
 * Périmètre : la course active (Express accepté) via active-course-store. La RLS
 * `orders_driver_select_assigned` garantit que le livreur ne reçoit l'event que
 * pour SA commande.
 */
export function DriverCancelWatch() {
  const course = useActiveCourse();
  const orderId = course?.orderId ?? null;
  const router = useRouter();
  const [cancelled, setCancelled] = useState<{
    orderNumber: string | null;
    merchantName: string | null;
  } | null>(null);

  useEffect(() => {
    if (!orderId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`driver-cancel:${orderId}`)
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
            status?: string;
            order_number?: string | null;
          };
          if (row.status === "cancelled") {
            // Coupe la course immédiatement (bandeau + écran plein) puis pop-up.
            void playAlert();
            clearActiveCourse();
            setCancelled({
              orderNumber: row.order_number ?? null,
              merchantName: course?.merchantName ?? null,
            });
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // course?.merchantName lu au moment de l'event (closure) — pas besoin de
    // re-souscrire s'il change ; seul l'orderId pilote l'abonnement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  if (!cancelled) return null;

  const ref = cancelled.orderNumber ? `#${cancelled.orderNumber}` : "";
  const close = () => {
    setCancelled(null);
    // Retour à l'accueil + re-fetch (la course n'existe plus côté serveur).
    router.push("/driver");
    router.refresh();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[120] flex items-center justify-center p-5"
      style={{ background: "rgba(15,18,30,.55)", backdropFilter: "blur(2px)" }}
    >
      <div
        className="w-full max-w-sm rounded-[20px] bg-[var(--surface)] p-5 text-center text-[var(--ink)]"
        style={{ boxShadow: "0 24px 60px -20px rgba(20,18,50,.5)" }}
      >
        <div
          className="mx-auto mb-3 grid size-14 place-items-center rounded-full"
          style={{ background: "#fee4e2", color: "#b42318" }}
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M15 9l-6 6M9 9l6 6" />
          </svg>
        </div>
        <h2 className="text-[17px] font-extrabold text-[#101828]">
          Commande annulée
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#475467]">
          La commande {ref}
          {cancelled.merchantName ? ` (${cancelled.merchantName})` : ""} a été{" "}
          <strong>annulée</strong>. Merci de t&apos;arrêter — ne te déplace plus
          vers le client. Contacte le support si besoin de plus de détails.
        </p>
        <button
          type="button"
          onClick={close}
          className="mt-4 w-full rounded-[12px] py-3 text-[15px] font-bold text-white"
          style={{ background: "#101828" }}
        >
          J&apos;ai compris
        </button>
      </div>
    </div>
  );
}
