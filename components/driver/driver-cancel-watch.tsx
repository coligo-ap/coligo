"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import {
  useActiveCourse,
  clearActiveCourse,
} from "@/lib/driver/active-course-store";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";
import { playAlert } from "@/lib/driver/sounds";

/**
 * DriverCancelWatch — clôture temps réel de la course active, quelle que soit
 * l'ISSUE décidée ailleurs (commerçant, client, SUPPORT) :
 *
 *  - `cancelled`  → pop-up « Commande annulée » + coupe la course ;
 *  - `completed`  → la plateforme a VALIDÉ la livraison à la place du livreur
 *    (support : client injoignable, litige, no-show en ligne « payé comme
 *    livré »…) → pop-up « Livraison clôturée, gains crédités » + coupe la
 *    course. Silencieux si c'est le livreur lui-même qui vient de valider
 *    (marqueur sessionStorage posé par le flux de validation) ;
 *  - commande RETIRÉE (réattribution / remise au réseau : la RLS
 *    `orders_driver_select_assigned` ne renvoie plus la ligne) → pop-up
 *    « Course retirée » + coupe la course.
 *
 * Sans ça, l'appareil du livreur reste BLOQUÉ sur un bandeau « Course en
 * cours » fantôme (incident du 07/07 : validation support → aucun signal au
 * livreur). Trois canaux se complètent : Realtime (app ouverte), push FCM
 * (arrière-plan), et une RESYNCHRONISATION au montage + à la reprise au
 * premier plan (useResumeResync) qui rattrape tout événement manqué.
 */

const SELF_DONE_PREFIX = "coligo_self_validated_";

/** À poser AVANT router.refresh quand le LIVREUR valide lui-même (pas de
 *  pop-up « clôturée par la plateforme » sur sa propre action). */
export function markSelfValidated(orderId: string) {
  try {
    sessionStorage.setItem(SELF_DONE_PREFIX + orderId, "1");
  } catch {
    /* sessionStorage indispo → au pire un pop-up informatif en trop */
  }
}

function wasSelfValidated(orderId: string): boolean {
  try {
    return sessionStorage.getItem(SELF_DONE_PREFIX + orderId) === "1";
  } catch {
    return false;
  }
}

type Closure = {
  kind: "cancelled" | "completed" | "withdrawn";
  orderNumber: string | null;
  merchantName: string | null;
};

export function DriverCancelWatch() {
  const course = useActiveCourse();
  const orderId = course?.orderId ?? null;
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const [closure, setClosure] = useState<Closure | null>(null);
  // Reprise au premier plan (timers/socket morts en arrière-plan) → re-fetch
  // immédiat + ré-abonnement du canal Realtime (nonce dans les deps de l'effet).
  const [resyncNonce, setResyncNonce] = useState(0);
  useResumeResync(() => setResyncNonce((n) => n + 1));

  useEffect(() => {
    if (!orderId) return;
    const supabase = createClient();

    const close = (
      kind: Closure["kind"],
      orderNumber: string | null = null
    ) => {
      if (kind === "completed" && wasSelfValidated(orderId)) {
        clearActiveCourse();
        return;
      }
      void playAlert();
      clearActiveCourse();
      setClosure({
        kind,
        orderNumber,
        merchantName: course?.merchantName ?? null,
      });
    };

    // RESYNC (montage + reprise) : état réel de la course — rattrape un
    // événement manqué app fermée/gelée. `maybeSingle` sans erreur et sans
    // ligne = la commande ne nous est PLUS visible (retirée / réattribuée).
    let alive = true;
    void supabase
      .from("orders")
      .select("id, status, order_number, delivery_driver_id")
      .eq("id", orderId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive || error) return; // erreur réseau → on ne conclut rien
        if (!data) {
          close("withdrawn");
        } else if (data.status === "completed") {
          close("completed", data.order_number ?? null);
        } else if (data.status === "cancelled") {
          close("cancelled", data.order_number ?? null);
        }
      });

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
            delivery_driver_id?: string | null;
          };
          if (row.status === "cancelled") {
            close("cancelled", row.order_number ?? null);
          } else if (row.status === "completed") {
            close("completed", row.order_number ?? null);
          }
          // NB : un retrait (delivery_driver_id → autre) coupe la visibilité
          // RLS — l'event peut ne pas arriver ; couvert par le resync + push.
        }
      )
      .subscribe();

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
    // course?.merchantName lu au moment de l'event (closure) — pas besoin de
    // re-souscrire s'il change ; orderId + resyncNonce pilotent l'abonnement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, resyncNonce]);

  if (!closure) return null;

  const ref = closure.orderNumber ? `#${closure.orderNumber}` : "";
  const close = () => {
    setClosure(null);
    // Retour à l'accueil + re-fetch (la course n'existe plus côté serveur).
    router.push("/driver");
    router.refresh();
  };

  const suffix = closure.merchantName ? ` (${closure.merchantName})` : "";
  const COPY: Record<
    Closure["kind"],
    { title: string; body: React.ReactNode; tone: "danger" | "success" }
  > = {
    cancelled: {
      title: isAr ? "أُلغيت الطلبية" : "Commande annulée",
      tone: "danger",
      body: isAr ? (
        <>
          الطلبية {ref}
          {suffix} <strong>أُلغيت</strong>. توقّف من فضلك — لا تواصل التنقل نحو
          الزبون. تواصل مع الدعم إذا احتجت مزيدًا من التفاصيل.
        </>
      ) : (
        <>
          La commande {ref}
          {suffix} a été <strong>annulée</strong>. Merci de t&apos;arrêter — ne
          te déplace plus vers le client. Contacte le support si besoin de plus
          de détails.
        </>
      ),
    },
    completed: {
      title: isAr ? "أُغلقت التوصيلة ✓" : "Livraison clôturée ✓",
      tone: "success",
      body: isAr ? (
        <>
          الطلبية {ref}
          {suffix} <strong>صادقت عليها المنصة</strong>: انتهت التوصيلة وأُضيفت
          أرباحك (مرئية في الأرباح / كشفك القادم). يمكنك استئناف التوصيلات.
        </>
      ) : (
        <>
          La commande {ref}
          {suffix} a été <strong>validée par la plateforme</strong> : la course
          est terminée et tes gains sont crédités (visibles dans Gains / ton
          prochain relevé). Tu peux reprendre les courses.
        </>
      ),
    },
    withdrawn: {
      title: isAr ? "سُحبت التوصيلة" : "Course retirée",
      tone: "danger",
      body: isAr ? (
        <>
          الطلبية {ref}
          {suffix} <strong>سحبتها منك المنصة</strong>. لا تواصل هذه التوصيلة —
          تواصل مع الدعم إذا لزم الأمر.
        </>
      ) : (
        <>
          La commande {ref}
          {suffix} t&apos;a été <strong>retirée par la plateforme</strong>. Ne
          poursuis pas cette livraison — contacte le support si besoin.
        </>
      ),
    },
  };
  const copy = COPY[closure.kind];

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
          style={
            copy.tone === "success"
              ? { background: "#dcfae6", color: "#067647" }
              : { background: "#fee4e2", color: "#b42318" }
          }
        >
          {copy.tone === "success" ? (
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
              <path d="M8.5 12.5l2.5 2.5 4.5-5" />
            </svg>
          ) : (
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
          )}
        </div>
        <h2 className="text-[17px] font-extrabold text-[#101828]">
          {copy.title}
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#475467]">
          {copy.body}
        </p>
        <button
          type="button"
          onClick={close}
          className="mt-4 w-full rounded-[12px] py-3 text-[15px] font-bold text-white"
          style={{ background: "#101828" }}
        >
          {isAr ? "فهمت" : "J'ai compris"}
        </button>
      </div>
    </div>
  );
}
