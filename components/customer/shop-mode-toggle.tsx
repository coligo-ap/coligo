"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { setCartMode, useCartFor } from "@/lib/customer/cart-store";

type Merchant = {
  id: string;
  slug: string;
  name: string;
  logo_url?: string | null;
};

/**
 * Bascule Retrait / Livraison — SEGMENTÉ façon Bolt Food (leur Delivery/Pickup) :
 * piste grise arrondie SANS icônes ni ombre interne, pilule blanche glissante
 * sous le segment actif, et DEUX lignes par segment (libellé gras + précision
 * grise : « gratuit » / « à votre adresse »). Le choix est PERSISTÉ dans le
 * panier de ce commerce (cart.mode) et pré-rempli au checkout. « Livraison »
 * n'est proposée que si le commerçant l'a activée.
 */
export function ShopModeToggle({
  merchant,
  deliveryEnabled,
  deliveryFeeLabel,
}: {
  merchant: Merchant;
  deliveryEnabled: boolean;
  deliveryFeeLabel?: string | null;
}) {
  const t = useTranslations("merchant");
  const cart = useCartFor(merchant.id);
  const mode =
    cart.mode === "delivery" && deliveryEnabled ? "delivery" : "pickup";

  const seg =
    "relative z-[1] flex min-w-0 flex-1 flex-col items-center justify-center rounded-full px-1 py-1.5 leading-tight transition-colors";

  return (
    <div className="bg-surface-2 relative flex h-full rounded-full p-1">
      {/* Pilule blanche qui glisse sous le segment actif (Bolt). */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-1 start-1 w-[calc(50%-0.25rem)] rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.10)] transition-transform duration-[340ms] [transition-timing-function:cubic-bezier(.34,1.4,.64,1)]",
          mode === "delivery" && "translate-x-full rtl:-translate-x-full"
        )}
      />
      <button
        type="button"
        onClick={() => setCartMode(merchant, "pickup")}
        aria-pressed={mode === "pickup"}
        className={seg}
      >
        <span
          className={cn(
            "text-body font-extrabold whitespace-nowrap",
            mode === "pickup" ? "text-foreground" : "text-muted"
          )}
        >
          {t("pickupLabel")}
        </span>
        <span
          className={cn(
            "text-caption font-medium whitespace-nowrap",
            mode === "pickup" ? "text-success-700" : "text-subtle"
          )}
        >
          {t("freeSub")}
        </span>
      </button>
      <button
        type="button"
        onClick={() => deliveryEnabled && setCartMode(merchant, "delivery")}
        aria-pressed={mode === "delivery"}
        disabled={!deliveryEnabled}
        className={cn(seg, "disabled:opacity-45")}
      >
        <span
          className={cn(
            "text-body font-extrabold whitespace-nowrap",
            mode === "delivery" ? "text-foreground" : "text-muted"
          )}
        >
          {t("delivery")}
        </span>
        <span
          className={cn(
            "text-caption max-w-full truncate font-medium",
            mode === "delivery" ? "text-muted" : "text-subtle"
          )}
        >
          {deliveryEnabled
            ? (deliveryFeeLabel ?? t("toYourAddress"))
            : t("unavailableShort")}
        </span>
      </button>
    </div>
  );
}
