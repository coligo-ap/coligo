"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  CartAddContext,
  type AddMerchant,
} from "@/components/customer/cart-mono-provider";
import type { AddItemInput } from "@/lib/customer/cart-store";
import { guestAddItem, guestJoin } from "@/app/p/[token]/actions";

// =============================================================================
// Provider d'ajout ALTERNATIF pour le catalogue en mode PANIER PARTAGÉ :
// même contrat `requestAdd` que le panier local — tout le catalogue existant
// (ProductDetailSheet, product-row, carrousels) fonctionne sans modification —
// mais l'ajout part vers le panier partagé SERVEUR (RPC token-validée + bump
// temps réel) au lieu du localStorage.
//
// ⚠️ OBLIGATOIRE sur la page catalogue invité : sans provider, le fallback de
// `useCartAdd` écrirait dans le panier localStorage du visiteur.
// =============================================================================

type GuestIdentity = { id: string; joined: boolean };

function readGuest(token: string): GuestIdentity {
  const key = `coligo:guest:${token}`;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as GuestIdentity;
  } catch {
    /* stockage indisponible */
  }
  const fresh = { id: crypto.randomUUID(), joined: false };
  try {
    window.localStorage.setItem(key, JSON.stringify(fresh));
  } catch {
    /* mode privé strict : identité éphémère */
  }
  return fresh;
}

export function SharedCartAddProvider({
  token,
  isCaptain,
  children,
}: {
  token: string;
  /** Capitaine connecté : la RPC le reconnaît via sa session (guest_token null). */
  isCaptain: boolean;
  children: React.ReactNode;
}) {
  const guestRef = useRef<GuestIdentity | null>(null);
  useEffect(() => {
    if (!isCaptain) guestRef.current = readGuest(token);
  }, [token, isCaptain]);

  const requestAdd = useCallback(
    (_merchant: AddMerchant, item: AddItemInput): boolean => {
      // Retour OPTIMISTE (`true` → flash visuel immédiat) : la room
      // resynchronise via le bump — jamais de double vérité.
      void (async () => {
        let guestToken: string | null = null;
        if (!isCaptain) {
          const g = guestRef.current ?? readGuest(token);
          guestRef.current = g;
          // Arrivée directe sur le catalogue sans être passé par la feuille
          // « Rejoindre » → adhésion silencieuse (« Invité N »), idempotente.
          if (!g.joined) {
            const res = await guestJoin({ token, guestToken: g.id });
            if (res.ok) {
              g.joined = true;
              try {
                window.localStorage.setItem(
                  `coligo:guest:${token}`,
                  JSON.stringify(g)
                );
              } catch {
                /* sans gravité */
              }
            }
          }
          guestToken = g.id;
        }
        await guestAddItem({
          token,
          guestToken,
          productId: item.product_id,
          optionIds: (item.options ?? []).map((o) => o.option_id),
          quantity: item.quantity ?? 1,
        });
      })();
      return true;
    },
    [token, isCaptain]
  );

  return (
    <CartAddContext.Provider value={{ requestAdd }}>
      {children}
    </CartAddContext.Provider>
  );
}
