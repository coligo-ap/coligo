"use client";

import { useEffect } from "react";
import { clearCart } from "@/lib/customer/cart-store";

// =============================================================================
// ClearCartOnMount — vide le panier client une fois au mount.
// Utilisé sur /checkout/success quand la commande arrive DÉJÀ paid (webhook
// plus rapide que la redirection Chargily). Le watcher ne fire pas dans ce
// cas-là car il n'est pas monté.
// =============================================================================
export function ClearCartOnMount() {
  useEffect(() => {
    clearCart();
  }, []);
  return null;
}
