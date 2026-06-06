"use client";

import { useTranslations } from "next-intl";
import { Bike, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { setCartMode, useCartFor } from "@/lib/customer/cart-store";

type Merchant = {
  id: string;
  slug: string;
  name: string;
  logo_url?: string | null;
};

/**
 * Toggle Retrait / Livraison sur la FICHE BOUTIQUE (pilule glissante, style
 * Uber). Le choix est PERSISTÉ dans le panier de ce commerce (cart.mode) →
 * conservé jusqu'au panier et pré-rempli au checkout. La position de livraison
 * reste choisie plus tard (au checkout) : ici on ne fait que mémoriser le mode.
 * « Livraison » n'est proposé que si le commerçant l'a activée.
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

  return (
    <div className="bg-surface-2 relative flex rounded-[16px] p-1.5 shadow-[inset_0_1px_3px_rgba(0,0,0,0.04)]">
      {/* Glider : pastille blanche qui glisse sous l'onglet actif. */}
      <span
        aria-hidden
        className={cn(
          "bg-surface absolute inset-y-1.5 start-1.5 w-[calc(50%-0.375rem)] rounded-[12px] shadow-[0_4px_12px_-2px_rgba(40,35,90,0.2)] transition-transform duration-[340ms] [transition-timing-function:cubic-bezier(.34,1.4,.64,1)]",
          mode === "delivery" && "translate-x-full rtl:-translate-x-full"
        )}
      />
      <button
        type="button"
        onClick={() => setCartMode(merchant, "pickup")}
        aria-pressed={mode === "pickup"}
        className={cn(
          "relative z-[1] flex min-w-0 flex-1 items-center justify-center gap-2 rounded-[12px] px-2 py-3 text-sm font-extrabold transition-colors",
          mode === "pickup" ? "text-foreground" : "text-muted"
        )}
      >
        <MapPin
          className={cn(
            "size-4 shrink-0",
            mode === "pickup" && "text-primary-600"
          )}
        />
        <span className="truncate">{t("freePickup")}</span>
      </button>
      <button
        type="button"
        onClick={() => deliveryEnabled && setCartMode(merchant, "delivery")}
        aria-pressed={mode === "delivery"}
        disabled={!deliveryEnabled}
        className={cn(
          "relative z-[1] flex min-w-0 flex-1 items-center justify-center gap-2 rounded-[12px] px-2 py-3 text-sm font-extrabold transition-colors disabled:opacity-40",
          mode === "delivery" ? "text-foreground" : "text-muted"
        )}
      >
        <Bike
          className={cn(
            "size-4 shrink-0",
            mode === "delivery" && "text-primary-600"
          )}
        />
        <span className="truncate">
          {deliveryEnabled
            ? `${t("delivery")}${deliveryFeeLabel ? ` ${deliveryFeeLabel}` : ""}`
            : t("deliveryUnavailable")}
        </span>
      </button>
    </div>
  );
}
