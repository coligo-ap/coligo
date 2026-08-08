"use client";

import { createContext, useContext, useState } from "react";
import { useTranslations } from "next-intl";
import { ShoppingBag } from "lucide-react";
import {
  addItem,
  clearAllCarts,
  readAllCarts,
  type AddItemInput,
} from "@/lib/customer/cart-store";

// =============================================================================
// Panier MONO-COMMERÇANT (volet 4) — un panier ne contient des articles que
// d'UN SEUL commerce. À l'ajout, si le client a déjà un panier NON VIDE chez un
// AUTRE commerçant → bottom-sheet de confirmation (vider / garder). Le panier
// n'est JAMAIS vidé sans confirmation explicite.
//
// `requestAdd` renvoie `true` si l'ajout a été fait immédiatement (pas de
// conflit) — l'appelant peut alors déclencher son feedback visuel (flash vert).
// Si un conflit ouvre la modale, il renvoie `false`.
// =============================================================================

export type AddMerchant = {
  id: string;
  slug: string;
  name: string;
  logo_url?: string | null;
};
export type CartAddCtx = {
  requestAdd: (merchant: AddMerchant, item: AddItemInput) => boolean;
};

/**
 * Exporté pour permettre un provider ALTERNATIF (panier partagé invité :
 * `SharedCartAddProvider` fournit le même contrat `requestAdd` mais pousse
 * vers le panier partagé serveur au lieu du localStorage) — tout le catalogue
 * (ProductDetailSheet, product-row…) fonctionne alors sans modification.
 */
export const CartAddContext = createContext<CartAddCtx | null>(null);
const Ctx = CartAddContext;

/**
 * Accès à l'ajout panier protégé mono-commerçant. Fallback hors provider :
 * ajout direct (par sécurité, ne casse pas un composant non enveloppé).
 */
export function useCartAdd(): CartAddCtx {
  const ctx = useContext(Ctx);
  if (ctx) return ctx;
  return {
    requestAdd: (merchant, item) => {
      addItem(merchant, item);
      return true;
    },
  };
}

export function CartMonoProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("cart");
  const [pending, setPending] = useState<{
    merchant: AddMerchant;
    item: AddItemInput;
    otherName: string;
  } | null>(null);

  const requestAdd = (merchant: AddMerchant, item: AddItemInput): boolean => {
    const conflict = readAllCarts().find(
      (c) =>
        c.merchant_id && c.merchant_id !== merchant.id && c.items.length > 0
    );
    if (conflict) {
      setPending({
        merchant,
        item,
        otherName: conflict.merchant_name ?? "",
      });
      return false;
    }
    addItem(merchant, item);
    return true;
  };

  const confirmSwitch = () => {
    if (!pending) return;
    clearAllCarts();
    addItem(pending.merchant, pending.item);
    // Confirmation VISUELLE : la modale se ferme et la barre panier persistante
    // affiche le nouveau commerce (pas de toast, cf. CLAUDE.md).
    setPending(null);
  };

  return (
    <Ctx.Provider value={{ requestAdd }}>
      {children}
      {pending && (
        <div
          role="dialog"
          aria-modal="true"
          className="animate-fade-in fixed inset-0 z-[95] flex items-end justify-center bg-[rgba(11,11,15,0.5)] backdrop-blur-[2px] sm:items-center"
          onClick={() => setPending(null)}
        >
          <div
            className="bg-surface animate-fade-in rounded-t-panel-lg sm:rounded-panel-lg w-full max-w-[420px] px-5 pt-2 pb-[calc(1.75rem+env(safe-area-inset-bottom))] sm:pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-border mx-auto mb-4 h-[5px] w-9 rounded-full sm:hidden" />
            <div className="mx-auto mb-3.5 grid size-[54px] place-items-center rounded-lg bg-[#FFF0EE] text-[#FF5A3C]">
              <ShoppingBag className="size-[26px]" />
            </div>
            <h3 className="text-foreground text-heading-sm text-center font-extrabold tracking-[-0.4px]">
              {t("monoTitle")}
            </h3>
            <p className="text-muted text-body mx-auto mt-2 max-w-[340px] text-center leading-relaxed font-semibold">
              {t.rich("monoBody", {
                current: pending.otherName,
                b: (chunks) => (
                  <b className="text-foreground font-extrabold">{chunks}</b>
                ),
              })}
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={confirmSwitch}
                className="bg-primary-600 hover:bg-primary-700 rounded-card-lg text-title-sm px-4 py-4 font-extrabold text-white transition active:scale-[0.98]"
              >
                {t("monoConfirm", { name: pending.merchant.name })}
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                className="text-muted hover:text-foreground rounded-md py-3 text-sm font-bold transition"
              >
                {t("monoKeep")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
