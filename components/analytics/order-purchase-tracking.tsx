"use client";

import { useEffect } from "react";
import {
  trackPurchase,
  trackRefund,
  type GaLineInput,
} from "@/lib/analytics/ecommerce";

// =============================================================================
// OrderPurchaseTracking — émet le `purchase` GA4 sur la page de confirmation.
// =============================================================================
// Rendu sur /commandes/[id] (page « merci »). Émet `purchase` UNE SEULE FOIS par
// commande, avec dédup CÔTÉ CLIENT (localStorage) en plus de la dédup GA par
// `transaction_id` → jamais de revenu compté deux fois sur un rechargement /
// une revisite. Si la commande déjà comptée est ensuite ANNULÉE, on émet un
// `refund` symétrique (une seule fois) pour ne pas surcompter le chiffre.
//
// No-op total si GA est désactivé (gaEvent garde la clé). Ne rend rien.
// =============================================================================

type Props = {
  orderId: string;
  /** Statut courant : on ne compte pas une commande annulée jamais achetée. */
  status: string;
  valueDa: number;
  shippingDa?: number;
  coupon?: string | null;
  merchantName?: string | null;
  lines: GaLineInput[];
};

export function OrderPurchaseTracking({
  orderId,
  status,
  valueDa,
  shippingDa,
  coupon,
  merchantName,
  lines,
}: Props) {
  useEffect(() => {
    if (typeof window === "undefined" || !orderId) return;
    const pKey = `ga:purchased:${orderId}`;
    const rKey = `ga:refunded:${orderId}`;
    let purchased = false;
    try {
      purchased = window.localStorage.getItem(pKey) === "1";
    } catch {
      /* localStorage indispo (mode privé) → on tente quand même l'event */
    }

    if (status !== "cancelled") {
      // Achat (commande placée) — une seule fois par appareil.
      if (purchased) return;
      trackPurchase({
        orderId,
        valueDa,
        lines,
        shippingDa,
        coupon,
        merchantName,
      });
      try {
        window.localStorage.setItem(pKey, "1");
      } catch {
        /* ignore */
      }
      return;
    }

    // Commande ANNULÉE : remboursement seulement si elle avait été comptée.
    let refunded = false;
    try {
      refunded = window.localStorage.getItem(rKey) === "1";
    } catch {
      /* ignore */
    }
    if (purchased && !refunded) {
      trackRefund(orderId, valueDa);
      try {
        window.localStorage.setItem(rKey, "1");
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, status]);

  return null;
}
