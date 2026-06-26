"use client";

import { useEffect, useState } from "react";
import { trackAddToCart } from "@/lib/analytics/ecommerce";

// =============================================================================
// Panier client — MULTI-commerce en localStorage, un seul "actif" à la fois.
// =============================================================================
// Évolution prompt 16 :
//   - Avant : un seul panier en localStorage, ajouter un produit d'un autre
//     commerce était BLOQUÉ avec mismatch=true.
//   - Maintenant : on stocke autant de paniers que de commerces fréquentés
//     (Record<merchant_id, Cart>) + un `active_merchant_id` qui définit le
//     panier "visible". Le conflit ne se résout PAS au remplissage : il est
//     délégué au checkout, qui propose au client deux boutons clairs
//     ("Continuer chez A" / "Abandonner et commander chez B").
//
// Règles :
//   - addItem(M, ...) ajoute au panier de M (en le créant si besoin) ET
//     marque M comme actif. Ne ÉCHOUE jamais sur un conflit — c'est le but.
//   - useCart() reste compatible : renvoie le panier ACTIF (ou vide stub).
//   - useOtherCarts() renvoie les paniers des AUTRES commerces (pour le
//     bandeau de conflit au checkout). Vide si pas de conflit.
//   - Migration douce depuis l'ancien format (one-cart) : on lit la clé
//     historique au boot et on convertit en {by_merchant, active_merchant_id}.

/** Une option/variante choisie sur une ligne (snapshot de libellés + delta). */
export type SelectedOption = {
  /** Id de l'option (pour la revalidation serveur — jamais le prix client). */
  option_id: string;
  group_id: string;
  group_name_fr: string;
  group_name_ar: string | null;
  option_name_fr: string;
  option_name_ar: string | null;
  price_delta_da: number;
};

export type CartItem = {
  product_id: string;
  /**
   * Clé de LIGNE = product_id + signature des options choisies. Deux
   * combinaisons d'options d'un même produit = deux lignes distinctes. Sert de
   * clé de fusion / quantité / suppression (et non plus le seul product_id).
   */
  line_key: string;
  name: string;
  /** Nom AR (snapshot, pour le ticket bilingue + affichage). */
  name_ar?: string | null;
  /** Prix unitaire EFFECTIF = prix de base + Σ deltas des options. */
  unit_price_da: number;
  quantity: number;
  image_url?: string | null;
  category_title?: string | null;
  /** Options/variantes choisies (vide pour un produit simple). */
  options?: SelectedOption[];
};

/** Entrée d'ajout au panier (line_key calculée par le store, pas par l'appelant). */
export type AddItemInput = {
  product_id: string;
  name: string;
  name_ar?: string | null;
  /** Prix unitaire EFFECTIF (base + options). */
  unit_price_da: number;
  quantity?: number;
  image_url?: string | null;
  category_title?: string | null;
  options?: SelectedOption[];
};

/**
 * Clé de ligne stable : product_id seul si pas d'options, sinon product_id +
 * signature triée des options (groupe:option). Indépendante de l'ordre de
 * sélection.
 */
export function lineKeyFor(
  productId: string,
  options?: SelectedOption[]
): string {
  if (!options || options.length === 0) return productId;
  const sig = options
    .map((o) => `${o.group_name_fr}=${o.option_name_fr}`)
    .sort()
    .join("|");
  return `${productId}#${sig}`;
}

export type CartMode = "pickup" | "delivery";

export type Cart = {
  merchant_id: string | null;
  merchant_slug: string | null;
  merchant_name: string | null;
  merchant_logo: string | null;
  items: CartItem[];
  /** Mode choisi DÈS la fiche boutique, persistant → pré-rempli au checkout.
   *  Absent sur les anciens paniers → traité comme "pickup" par défaut. */
  mode?: CartMode;
  updated_at: string;
};

type Store = {
  active_merchant_id: string | null;
  by_merchant: Record<string, Cart>;
};

const STORAGE_KEY = "coligo:customer:cart";

const EMPTY_CART: Cart = {
  merchant_id: null,
  merchant_slug: null,
  merchant_name: null,
  merchant_logo: null,
  items: [],
  mode: "pickup",
  updated_at: new Date(0).toISOString(),
};

const EMPTY_STORE: Store = {
  active_merchant_id: null,
  by_merchant: {},
};

function broadcast(store: Store) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("coligo:cart:change", { detail: store })
  );
}

/**
 * Lit le store depuis localStorage. Supporte deux formats :
 *   - Nouveau : { active_merchant_id, by_merchant: { [mid]: Cart } }
 *   - Ancien (prompt 13/14) : { merchant_id, merchant_slug, merchant_name,
 *     items, updated_at } — converti à la volée.
 */
/**
 * Backfill des `line_key` manquantes (paniers d'avant les options) : un item
 * sans line_key reçoit product_id (+ signature options s'il en a). Idempotent.
 */
function ensureLineKeys(store: Store): Store {
  let changed = false;
  const by: Record<string, Cart> = {};
  for (const [mid, cart] of Object.entries(store.by_merchant)) {
    let cartChanged = false;
    const items = cart.items.map((i) => {
      if (i.line_key) return i;
      cartChanged = true;
      changed = true;
      return { ...i, line_key: lineKeyFor(i.product_id, i.options) };
    });
    by[mid] = cartChanged ? { ...cart, items } : cart;
  }
  return changed ? { ...store, by_merchant: by } : store;
}

function readStore(): Store {
  if (typeof window === "undefined") return EMPTY_STORE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STORE;
    const parsed = JSON.parse(raw) as Partial<Store> & Partial<Cart>;

    // Nouveau format
    if (parsed && typeof parsed === "object" && "by_merchant" in parsed) {
      return ensureLineKeys({
        active_merchant_id: parsed.active_merchant_id ?? null,
        by_merchant: parsed.by_merchant ?? {},
      });
    }

    // Ancien format → migration
    if (parsed && typeof parsed === "object" && "items" in parsed) {
      const old = parsed as Partial<Cart>;
      if (old.merchant_id && Array.isArray(old.items) && old.items.length > 0) {
        const cart: Cart = {
          merchant_id: old.merchant_id,
          merchant_slug: old.merchant_slug ?? null,
          merchant_name: old.merchant_name ?? null,
          merchant_logo: null,
          items: old.items,
          updated_at: old.updated_at ?? new Date().toISOString(),
        };
        return ensureLineKeys({
          active_merchant_id: old.merchant_id,
          by_merchant: { [old.merchant_id]: cart },
        });
      }
    }
    return EMPTY_STORE;
  } catch {
    return EMPTY_STORE;
  }
}

function writeStore(store: Store): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  broadcast(store);
}

function activeCart(store: Store): Cart {
  const id = store.active_merchant_id;
  if (!id) return EMPTY_CART;
  return store.by_merchant[id] ?? EMPTY_CART;
}

// =============================================================================
// API publique — lecture
// =============================================================================

/** Lit le panier actif (compat avec l'API d'origine). */
export function readCart(): Cart {
  return activeCart(readStore());
}

/** Renvoie tous les paniers stockés (actif + autres). */
export function readAllCarts(): Cart[] {
  return Object.values(readStore().by_merchant);
}

// =============================================================================
// API publique — mutation
// =============================================================================

/**
 * Ajoute / incrémente un produit dans le panier du commerce donné, et
 * BASCULE l'actif sur ce commerce. Ne bloque JAMAIS si le client avait déjà
 * un panier chez un autre commerçant (cf. prompt 16).
 */
export function addItem(
  merchant: {
    id: string;
    slug: string;
    name: string;
    logo_url?: string | null;
  },
  item: AddItemInput
): { ok: true } {
  const store = readStore();
  const qty = Math.max(1, Math.floor(item.quantity ?? 1));
  const current: Cart = store.by_merchant[merchant.id] ?? {
    merchant_id: merchant.id,
    merchant_slug: merchant.slug,
    merchant_name: merchant.name,
    merchant_logo: merchant.logo_url ?? null,
    items: [],
    mode: "pickup",
    updated_at: new Date().toISOString(),
  };

  const lineKey = lineKeyFor(item.product_id, item.options);
  const items = [...current.items];
  // Fusion par LIGNE (product_id + options), pas seulement par produit.
  const existing = items.findIndex((i) => i.line_key === lineKey);
  if (existing >= 0) {
    items[existing] = {
      ...items[existing],
      quantity: items[existing].quantity + qty,
    };
  } else {
    items.push({
      product_id: item.product_id,
      line_key: lineKey,
      name: item.name,
      name_ar: item.name_ar ?? null,
      unit_price_da: item.unit_price_da,
      quantity: qty,
      image_url: item.image_url ?? null,
      category_title: item.category_title ?? null,
      options: item.options && item.options.length ? item.options : undefined,
    });
  }

  const nextCart: Cart = {
    merchant_id: merchant.id,
    merchant_slug: merchant.slug,
    merchant_name: merchant.name,
    merchant_logo: merchant.logo_url ?? current.merchant_logo ?? null,
    items,
    mode: current.mode ?? "pickup",
    updated_at: new Date().toISOString(),
  };

  const nextStore: Store = {
    active_merchant_id: merchant.id,
    by_merchant: { ...store.by_merchant, [merchant.id]: nextCart },
  };
  writeStore(nextStore);

  // GA4 — add_to_cart (qté réellement ajoutée à ce tap, pas le cumul). No-op si
  // GA désactivé.
  trackAddToCart(
    {
      id: item.product_id,
      name: item.name,
      unitPriceDa: item.unit_price_da,
      quantity: qty,
      category: item.category_title ?? null,
    },
    merchant.name
  );

  return { ok: true };
}

/**
 * Persiste le MODE (retrait/livraison) choisi sur la fiche boutique, par
 * commerce. Crée une entrée panier minimale si besoin (pour que le choix
 * survive même avant d'ajouter un produit). NE CHANGE PAS l'actif (un simple
 * toggle de mode ne doit pas voler la vedette à un panier en cours ailleurs).
 */
export function setCartMode(
  merchant: {
    id: string;
    slug: string;
    name: string;
    logo_url?: string | null;
  },
  mode: CartMode
): void {
  const store = readStore();
  const current = store.by_merchant[merchant.id];
  const cart: Cart = current
    ? { ...current, mode, updated_at: new Date().toISOString() }
    : {
        merchant_id: merchant.id,
        merchant_slug: merchant.slug,
        merchant_name: merchant.name,
        merchant_logo: merchant.logo_url ?? null,
        items: [],
        mode,
        updated_at: new Date().toISOString(),
      };
  writeStore({
    ...store,
    by_merchant: { ...store.by_merchant, [merchant.id]: cart },
  });
}

/**
 * Modifie la quantité d'une LIGNE (line_key) dans le panier ACTIF. qty <= 0
 * supprime. Pour un produit simple, line_key === product_id (rétro-compat).
 */
export function setItemQuantity(lineKey: string, quantity: number): void {
  const store = readStore();
  const id = store.active_merchant_id;
  if (!id) return;
  const cart = store.by_merchant[id];
  if (!cart) return;
  const items = cart.items
    .map((i) =>
      i.line_key === lineKey
        ? { ...i, quantity: Math.max(0, Math.floor(quantity)) }
        : i
    )
    .filter((i) => i.quantity > 0);

  if (items.length === 0) {
    // Plus aucun item → on retire ce panier du store, et on bascule l'actif
    // sur un autre panier non vide s'il en reste un.
    clearMerchantCart(id);
    return;
  }
  const nextStore: Store = {
    ...store,
    by_merchant: {
      ...store.by_merchant,
      [id]: { ...cart, items, updated_at: new Date().toISOString() },
    },
  };
  writeStore(nextStore);
}

export function removeItem(lineKey: string): void {
  setItemQuantity(lineKey, 0);
}

/** Vide le panier ACTIF (et bascule l'actif sur un autre cart restant, s'il y en a). */
export function clearCart(): void {
  const store = readStore();
  const id = store.active_merchant_id;
  if (!id) return;
  clearMerchantCart(id);
}

/**
 * Supprime le panier d'un commerce précis. Si c'était l'actif, on en
 * réactive un autre arbitrairement (le plus récent), sinon `null`.
 */
export function clearMerchantCart(merchantId: string): void {
  const store = readStore();
  if (!store.by_merchant[merchantId]) return;
  const next: Record<string, Cart> = {};
  for (const [k, v] of Object.entries(store.by_merchant)) {
    if (k !== merchantId) next[k] = v;
  }
  let active = store.active_merchant_id;
  if (active === merchantId) {
    const others = Object.values(next).sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at)
    );
    active = others[0]?.merchant_id ?? null;
  }
  writeStore({ active_merchant_id: active, by_merchant: next });
}

/** Bascule l'actif sur un commerce donné (sans muter son contenu). */
export function setActiveMerchant(merchantId: string | null): void {
  const store = readStore();
  if (merchantId && !store.by_merchant[merchantId]) return;
  if (store.active_merchant_id === merchantId) return;
  writeStore({ ...store, active_merchant_id: merchantId });
}

/** Vide TOUS les paniers (rarement utilisé — ex: deconnexion ou reset). */
export function clearAllCarts(): void {
  writeStore(EMPTY_STORE);
}

// =============================================================================
// Hooks React
// =============================================================================

function useStore(): Store {
  const [s, setS] = useState<Store>(EMPTY_STORE);
  useEffect(() => {
    setS(readStore());
    const onChange = (e: Event) => {
      const ce = e as CustomEvent<Store>;
      setS(ce.detail ?? readStore());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setS(readStore());
    };
    window.addEventListener("coligo:cart:change", onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("coligo:cart:change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return s;
}

/** Panier ACTIF (compat avec l'API d'origine). */
export function useCart(): Cart {
  return activeCart(useStore());
}

/** Tous les paniers, l'actif inclus (utile pour debug). */
export function useAllCarts(): Cart[] {
  return Object.values(useStore().by_merchant);
}

/**
 * Paniers des AUTRES commerces (utilisé par le bandeau de conflit au checkout
 * — prompt 16). Vide quand il n'y a pas de conflit.
 */
export function useOtherCarts(): Cart[] {
  const store = useStore();
  const active = store.active_merchant_id;
  return Object.values(store.by_merchant).filter(
    (c) => c.merchant_id !== active && c.items.length > 0
  );
}

/** Panier d'un commerce précis (ex: fiche /m/[slug] qui n'est pas l'actif). */
export function useCartFor(merchantId: string | null | undefined): Cart {
  const store = useStore();
  if (!merchantId) return EMPTY_CART;
  return store.by_merchant[merchantId] ?? EMPTY_CART;
}

// =============================================================================
// Utilitaires PURS
// =============================================================================

/** Nb total d'unités dans un panier (pour le badge du header). */
export function totalUnits(cart: Cart): number {
  return cart.items.reduce((s, i) => s + i.quantity, 0);
}

/** Sous-total brut (sans promo, sans frais). Pour aperçu rapide. */
export function rawSubtotal(cart: Cart): number {
  return cart.items.reduce((s, i) => s + i.unit_price_da * i.quantity, 0);
}
