"use client";

import Link from "next/link";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Heart } from "lucide-react";
import { fetchFavoriteMerchants } from "@/app/(customer)/favoris/actions";
import { MerchantCardCompact } from "@/components/customer/merchant-card-compact";

/**
 * Liste des favoris via TanStack Query (cache persistant, clé par client). Au
 * retour sur l'écran : affichage INSTANTANÉ depuis le cache + revalidation en
 * fond (staleTime 0). Retirer un favori (cœur) invalide la requête → la carte
 * disparaît sans recharger toute la route.
 *
 * Sécurité : clé par customerId + action serveur ré-authentifiée (RLS).
 */
export function FavoritesLoader({ customerId }: { customerId: string }) {
  const t = useTranslations("account");
  const queryClient = useQueryClient();
  const queryKey = ["customer-favorites", customerId];
  const { data, isPending } = useQuery({
    queryKey,
    queryFn: () => fetchFavoriteMerchants(),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

  if (isPending && !data) {
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-3 h-28 animate-pulse rounded-[16px]"
          />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="border-border bg-surface text-muted rounded-[18px] border px-6 py-14 text-center">
        <Heart className="text-subtle mx-auto mb-3 size-8" />
        <p className="text-foreground font-semibold">{t("noFavoritesYet")}</p>
        <p className="mt-1 text-sm">{t("noFavoritesHint")}</p>
        <Link
          href="/"
          className="bg-primary-600 hover:bg-primary-700 mt-5 inline-flex items-center rounded-full px-5 py-2.5 text-sm font-semibold text-white"
        >
          {t("discoverMerchants")}
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {data.map((m) => (
        <MerchantCardCompact
          key={m.id}
          merchant={m}
          initialFavorite
          isAuth
          onFavoriteToggled={() => queryClient.invalidateQueries({ queryKey })}
        />
      ))}
    </div>
  );
}
