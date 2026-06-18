"use client";

import Link from "next/link";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ClipboardList } from "lucide-react";
import { fetchMyOrders } from "@/app/(customer)/commandes/actions";
import { CustomerOrdersTabs } from "@/components/customer/customer-orders-tabs";

/**
 * Liste des commandes via TanStack Query (cache partagé persistant, clé par
 * client). Au RETOUR sur l'écran, les commandes s'affichent INSTANTANÉMENT
 * depuis le cache puis se rafraîchissent en silence si périmées (staleTime 30 s)
 * — plus de re-fetch RSC bloquant à chaque montage. 1ʳᵉ visite : skeleton léger.
 *
 * Sécurité : la clé inclut customerId (isolation par compte) ; l'action serveur
 * ré-authentifie (getCurrentCustomer) + RLS à chaque appel.
 */
export function OrdersLoader({ customerId }: { customerId: string }) {
  const t = useTranslations("orders");
  const { data, isPending } = useQuery({
    queryKey: ["customer-orders", customerId],
    queryFn: () => fetchMyOrders(),
    placeholderData: keepPreviousData,
    // Les commandes changent via des mutations sur d'AUTRES écrans (checkout,
    // annulation côté détail). On revalide donc à chaque montage tout en
    // affichant le cache INSTANTANÉMENT (stale-while-revalidate) → toujours à
    // jour, sans écran de chargement au retour.
    staleTime: 0,
  });

  if (isPending && !data) {
    return (
      <div className="space-y-3">
        <div className="bg-surface-3 h-10 w-56 animate-pulse rounded-[12px]" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-3 h-24 animate-pulse rounded-[16px]"
          />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="border-border bg-surface mx-auto max-w-md rounded-[16px] border p-10 text-center">
        <ClipboardList className="text-primary-500 mx-auto size-10" />
        <p className="text-foreground mt-3 text-sm font-semibold">
          {t("emptyTitle")}
        </p>
        <p className="text-muted mt-1 text-xs">{t("emptyDescription")}</p>
        <Link
          href="/"
          className="bg-primary-600 hover:bg-primary-700 mt-4 inline-flex rounded-[10px] px-4 py-2 text-sm font-medium text-white"
        >
          {t("seeMerchants")}
        </Link>
      </div>
    );
  }

  return <CustomerOrdersTabs orders={data} />;
}
