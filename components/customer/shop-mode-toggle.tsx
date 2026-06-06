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
 * Toggle Retrait / Livraison sur la FICHE BOUTIQUE (style Uber).
 * Le choix est PERSISTÉ dans le panier de ce commerce (cart.mode) → conservé
 * jusqu'au panier et pré-rempli au checkout. La position de livraison reste
 * choisie plus tard (au checkout) : ici on ne fait que mémoriser le mode.
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
    <div className="bg-surface-2 mt-1 flex gap-2 rounded-[14px] p-1.5">
      <button
        type="button"
        onClick={() => setCartMode(merchant, "pickup")}
        aria-pressed={mode === "pickup"}
        className={cn(
          "flex min-w-0 flex-1 items-center justify-center gap-2 rounded-[10px] px-2 py-2.5 text-sm font-extrabold transition",
          mode === "pickup"
            ? "bg-surface text-foreground shadow-sm"
            : "text-muted"
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
          "flex min-w-0 flex-1 items-center justify-center gap-2 rounded-[10px] px-2 py-2.5 text-sm font-extrabold transition disabled:opacity-40",
          mode === "delivery"
            ? "bg-surface text-foreground shadow-sm"
            : "text-muted"
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
