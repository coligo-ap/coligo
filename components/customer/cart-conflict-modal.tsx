"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShoppingBag, X } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { cldUrl } from "@/lib/images/cloudinary";
import {
  clearMerchantCart,
  rawSubtotal,
  setActiveMerchant,
  totalUnits,
  type Cart,
} from "@/lib/customer/cart-store";

// =============================================================================
// Modale "panier d'un autre commerce" — affichée AU CHECKOUT (prompt 16).
// =============================================================================
// Le client est en train de commander chez B mais il a aussi un panier chez A.
// On lui montre les deux paniers (logo + nom + nb articles + total) et deux
// boutons clairs :
//   - « Continuer chez A » → bascule l'actif sur A, redirige vers /checkout
//   - « Abandonner ce panier et commander chez B » → supprime le panier de A
//
// Ton bienveillant, pas d'erreur sèche : c'est une aide à la navigation.

type Props = {
  /** Le panier actuel (celui de B, le commerce où le client veut commander). */
  current: Cart;
  /** Les paniers chez les AUTRES commerces (généralement 1, parfois plusieurs). */
  others: Cart[];
  /** Appelé quand le conflit est résolu et qu'on peut continuer le checkout. */
  onResolved: () => void;
};

export function CartConflictModal({ current, others, onResolved }: Props) {
  const router = useRouter();

  // Empêche le scroll du body tant que la modale est ouverte.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  function continueWith(cart: Cart) {
    if (!cart.merchant_id) return;
    setActiveMerchant(cart.merchant_id);
    router.push("/checkout");
  }

  function abandon(cart: Cart) {
    if (!cart.merchant_id) return;
    clearMerchantCart(cart.merchant_id);
    // Si on supprime le dernier "autre", la modale doit se fermer pour
    // poursuivre le checkout courant. Le parent re-render via useOtherCarts().
    if (others.length === 1) onResolved();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      role="dialog"
      aria-modal
      aria-labelledby="cart-conflict-title"
    >
      <div className="bg-surface flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-[20px] shadow-xl sm:rounded-[20px]">
        <header className="border-border flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2
              id="cart-conflict-title"
              className="text-foreground text-lg font-bold"
            >
              Tu as déjà un panier en cours
            </h2>
            <p className="text-muted mt-0.5 text-xs">
              {others.length === 1
                ? `Tu prépares une commande chez ${current.merchant_name ?? "ce commerce"} mais ton panier chez ${others[0].merchant_name ?? "un autre commerce"} contient encore des articles.`
                : `Tu as plusieurs paniers en attente. Une commande ne peut concerner qu'un seul commerce.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onResolved}
            className="text-muted hover:text-foreground hover:bg-surface-2 rounded-full p-1.5"
            aria-label="Fermer"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {others.map((other) => (
            <CartCard
              key={other.merchant_id}
              cart={other}
              highlight={false}
              onContinue={() => continueWith(other)}
              onAbandon={() => abandon(other)}
              currentName={current.merchant_name ?? "ce commerce"}
            />
          ))}

          {/* Petit rappel du panier en cours (B), pour orientation. */}
          <div className="border-border bg-primary-50/40 mt-2 rounded-[14px] border border-dashed p-3 text-xs">
            <p className="text-muted">
              Tu es actuellement sur le checkout de{" "}
              <strong className="text-foreground">
                {current.merchant_name ?? "ce commerce"}
              </strong>{" "}
              ({totalUnits(current)} article{totalUnits(current) > 1 ? "s" : ""}{" "}
              · {formatDA(rawSubtotal(current))}).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CartCard({
  cart,
  highlight,
  onContinue,
  onAbandon,
  currentName,
}: {
  cart: Cart;
  highlight: boolean;
  onContinue: () => void;
  onAbandon: () => void;
  currentName: string;
}) {
  const count = totalUnits(cart);
  const subtotal = rawSubtotal(cart);
  const logoOptimized = cldUrl(cart.merchant_logo, {
    width: 96,
    height: 96,
    crop: "fill",
    gravity: "auto",
  });

  return (
    <div
      className={cn(
        "border-border rounded-[14px] border p-3",
        highlight ? "bg-primary-50" : "bg-surface"
      )}
    >
      <div className="flex items-center gap-3">
        {logoOptimized ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoOptimized}
            alt=""
            loading="lazy"
            decoding="async"
            className="border-border size-12 shrink-0 rounded-full border bg-white object-cover"
          />
        ) : (
          <div className="bg-primary-100 text-primary-700 flex size-12 shrink-0 items-center justify-center rounded-full text-base font-bold">
            {(cart.merchant_name ?? "?").charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-foreground line-clamp-1 text-sm font-semibold">
            {cart.merchant_name ?? "Commerce"}
          </p>
          <p className="text-muted text-xs">
            <ShoppingBag className="-mt-0.5 mr-1 inline size-3" />
            {count} article{count > 1 ? "s" : ""} ·{" "}
            <span className="text-foreground font-semibold tabular-nums">
              {formatDA(subtotal)}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onContinue}
          className="bg-primary-600 hover:bg-primary-700 inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 py-2.5 text-sm font-semibold text-white transition-colors"
        >
          Continuer chez {cart.merchant_name ?? "ce commerce"}
        </button>
        <button
          type="button"
          onClick={onAbandon}
          className="border-danger-200 bg-danger-50 text-danger-700 hover:bg-danger-100 inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border px-3 py-2.5 text-xs font-semibold transition-colors sm:text-sm"
        >
          Abandonner et commander chez {currentName}
        </button>
      </div>
    </div>
  );
}
