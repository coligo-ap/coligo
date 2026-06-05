"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { toggleFavorite } from "@/app/(customer)/actions";

/**
 * Cœur favori PERSISTÉ (table `customer_favorites`).
 *  - Connecté : toggle optimiste + persistance serveur (revert si erreur).
 *  - Non connecté : redirige vers la connexion (next = page courante).
 * Comme il vit souvent dans un <Link> (carte commerce), on stoppe la
 * propagation pour ne pas naviguer au tap sur le cœur.
 *
 * `variant` :
 *  - "card" : rond blanc sur l'image d'une carte commerce.
 *  - "hero" : rond translucide sur la grande cover de la page commerce.
 * `refreshOnToggle` : rafraîchit la route après toggle (utile sur /favoris pour
 * faire disparaître une carte qu'on vient de retirer).
 */
export function FavoriteHeart({
  merchantId,
  initialFavorite = false,
  isAuth = false,
  variant = "card",
  refreshOnToggle = false,
  className,
}: {
  merchantId: string;
  initialFavorite?: boolean;
  isAuth?: boolean;
  variant?: "card" | "hero";
  refreshOnToggle?: boolean;
  className?: string;
}) {
  const [fav, setFav] = useState(initialFavorite);
  const [pending, start] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("listing");

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    if (!isAuth) {
      router.push(`/se-connecter?next=${encodeURIComponent(pathname || "/")}`);
      return;
    }
    const optimistic = !fav;
    setFav(optimistic);
    start(async () => {
      const res = await toggleFavorite(merchantId);
      if (res.error) {
        setFav(!optimistic); // revert
        if (res.error === "auth") {
          router.push(
            `/se-connecter?next=${encodeURIComponent(pathname || "/")}`
          );
        } else {
          toast.error(t("favoriteUpdateError"));
        }
        return;
      }
      setFav(res.favorite);
      if (refreshOnToggle) router.refresh();
    });
  }

  return (
    <button
      type="button"
      aria-label={fav ? t("removeFromFavorites") : t("addToFavorites")}
      aria-pressed={fav}
      onClick={onClick}
      className={cn(
        "grid place-items-center rounded-full shadow-md backdrop-blur transition-transform active:scale-90",
        variant === "hero"
          ? "size-10 bg-black/30 text-white hover:bg-black/40"
          : "size-9 bg-white/95",
        className
      )}
    >
      <Heart
        className={cn(
          variant === "hero" ? "size-5" : "size-[18px]",
          "transition-colors",
          fav
            ? "fill-coral-500 text-coral-500"
            : variant === "hero"
              ? "text-white"
              : "text-foreground"
        )}
      />
    </button>
  );
}
