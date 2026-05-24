"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearCart } from "@/lib/customer/cart-store";

// =============================================================================
// CheckoutPaymentWatcher
// =============================================================================
// Côté `/checkout/success`, on attend que le webhook Chargily ait confirmé le
// paiement (payment_status = paid). On combine :
//   - un poll léger (toutes les 3s, 20 tentatives = 1 min max)
//   - une souscription Realtime sur la ligne `orders` (RLS l'autorise pour le
//     client propriétaire), ce qui notifie quasi instantanément.
// Dès qu'on détecte 'paid', on `clearCart()` + `router.refresh()` → la page
// server re-rend en mode "Paid", et le panier est vidé proprement (il était
// resté intact pendant la redirection Chargily pour permettre un retry).
// =============================================================================
export function CheckoutPaymentWatcher({ orderId }: { orderId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let stopped = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 20;

    async function check() {
      if (stopped) return;
      attempts += 1;
      const { data } = await supabase
        .from("orders")
        .select("status, payment_status")
        .eq("id", orderId)
        .maybeSingle();
      if (stopped) return;
      if (data?.payment_status === "paid") {
        stopped = true;
        clearCart();
        router.refresh();
        return;
      }
      // Échec détecté pendant l'attente : Chargily a notifié failed/canceled
      // (webhook → orders.status='cancelled'). On redirige le client vers la
      // page d'échec dédiée. PAS de clearCart — le panier reste intact pour
      // qu'il puisse repasser commande sans tout refaire.
      if (data?.status === "cancelled" || data?.payment_status === "failed") {
        stopped = true;
        window.location.replace(`/checkout/failure?order_id=${orderId}`);
        return;
      }
      if (attempts < MAX_ATTEMPTS) {
        setTimeout(check, 3000);
      }
    }
    setTimeout(check, 1500);

    // Realtime : dès que la ligne `orders` mute (le webhook fait l'UPDATE), on
    // re-vérifie. RLS autorise SELECT côté client propriétaire (cf. policy
    // orders_select_own_customer).
    const channel = supabase
      .channel(`order-payment-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `id=eq.${orderId}`,
        },
        () => check()
      )
      .subscribe();

    return () => {
      stopped = true;
      supabase.removeChannel(channel);
    };
  }, [orderId, router]);

  return null;
}
