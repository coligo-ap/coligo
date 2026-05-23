"use client";

import { useEffect, useState } from "react";

// =============================================================================
// Panier client — mono-commerce, persisté en localStorage.
// =============================================================================
// Règles :
//   - Un panier appartient à UN SEUL commerce à la fois. Ajouter un produit
//     d'un autre commerce demande de vider l'existant.
//   - Aucun calcul de prix ici : on stocke juste prix unitaire et quantité,
//     le moteur (`lib/promotions/engine.ts`) recalcule en aval (panier +
//     checkout) — et le serveur RE-calcule à la création de commande.
//   - Le panier SURVIT à la connexion : on le persiste localStorage,
//     indépendamment de la session Supabase.

export type CartItem = {
  product_id: string;
  name: string;
  unit_price_da: number;
  quantity: number;
  image_url?: string | null;
  category_title?: string | null;
};

export type Cart = {
  merchant_id: string | null;
  merchant_slug: string | null;
  merchant_name: string | null;
  items: CartItem[];
  updated_at: string;
};

const STORAGE_KEY = "coligo:customer:cart";

const EMPTY_CART: Cart = {
  merchant_id: null,
  merchant_slug: null,
  merchant_name: null,
  items: [],
  updated_at: new Date(0).toISOString(),
};

function broadcast(cart: Cart) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("coligo:cart:change", { detail: cart }));
}

export function readCart(): Cart {
  if (typeof window === "undefined") return EMPTY_CART;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_CART;
    const parsed = JSON.parse(raw) as Cart;
    return {
      merchant_id: parsed.merchant_id ?? null,
      merchant_slug: parsed.merchant_slug ?? null,
      merchant_name: parsed.merchant_name ?? null,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      updated_at: parsed.updated_at ?? new Date().toISOString(),
    };
  } catch {
    return EMPTY_CART;
  }
}

export function writeCart(cart: Cart): void {
  if (typeof window === "undefined") return;
  const next = { ...cart, updated_at: new Date().toISOString() };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  broadcast(next);
}

export function clearCart(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  broadcast(EMPTY_CART);
}

/**
 * Ajoute (ou incrémente) un produit dans le panier.
 * Renvoie `mismatch: true` si on essaie d'ajouter un produit d'un autre
 * commerce que le panier courant (l'UI doit alors proposer de vider).
 */
export function addItem(
  merchant: { id: string; slug: string; name: string },
  item: Omit<CartItem, "quantity"> & { quantity?: number }
): { ok: boolean; mismatch?: boolean } {
  const current = readCart();
  if (
    current.merchant_id &&
    current.items.length > 0 &&
    current.merchant_id !== merchant.id
  ) {
    return { ok: false, mismatch: true };
  }
  const qty = Math.max(1, Math.floor(item.quantity ?? 1));
  const items = [...current.items];
  const existing = items.findIndex((i) => i.product_id === item.product_id);
  if (existing >= 0) {
    items[existing] = {
      ...items[existing],
      quantity: items[existing].quantity + qty,
    };
  } else {
    items.push({
      product_id: item.product_id,
      name: item.name,
      unit_price_da: item.unit_price_da,
      quantity: qty,
      image_url: item.image_url ?? null,
      category_title: item.category_title ?? null,
    });
  }
  writeCart({
    merchant_id: merchant.id,
    merchant_slug: merchant.slug,
    merchant_name: merchant.name,
    items,
    updated_at: new Date().toISOString(),
  });
  return { ok: true };
}

export function setItemQuantity(productId: string, quantity: number): void {
  const current = readCart();
  const items = current.items
    .map((i) =>
      i.product_id === productId
        ? { ...i, quantity: Math.max(0, Math.floor(quantity)) }
        : i
    )
    .filter((i) => i.quantity > 0);
  if (items.length === 0) {
    clearCart();
    return;
  }
  writeCart({ ...current, items });
}

export function removeItem(productId: string): void {
  setItemQuantity(productId, 0);
}

export function useCart(): Cart {
  const [cart, setCart] = useState<Cart>(EMPTY_CART);
  useEffect(() => {
    setCart(readCart());
    const onChange = (e: Event) => {
      const ce = e as CustomEvent<Cart>;
      setCart(ce.detail ?? readCart());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setCart(readCart());
    };
    window.addEventListener("coligo:cart:change", onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("coligo:cart:change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return cart;
}

/** Nb total d'unités dans le panier (pour le badge du header). */
export function totalUnits(cart: Cart): number {
  return cart.items.reduce((s, i) => s + i.quantity, 0);
}

/** Sous-total brut (sans promo, sans frais). Pour aperçu rapide. */
export function rawSubtotal(cart: Cart): number {
  return cart.items.reduce((s, i) => s + i.unit_price_da * i.quantity, 0);
}
