"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchMyWalletBalances } from "@/app/(customer)/actions";
import { formatDA } from "@/lib/utils";

/**
 * Valeur d'un solde (cashback OU Coligo Pay) en stale-while-revalidate. Le
 * markup autour (cartes, hero) reste rendu côté serveur : seul le NOMBRE est
 * piloté ici. Au montage, la valeur SSR (`initial`) s'affiche INSTANTANÉMENT
 * puis se rafraîchit en silence ; au retour sur l'écran (ou en passant de
 * /compte à /coligo-pay) la valeur vient du cache partagé (clé `userId`) sans
 * re-fetch tant qu'elle est fraîche.
 *
 * Sécurité : la clé inclut `userId` (isolation par compte) ; l'action serveur
 * ré-authentifie + RLS à chaque appel.
 */
export function WalletBalanceValue({
  kind,
  userId,
  initial,
  className,
}: {
  kind: "cashback" | "topup";
  userId: string;
  initial: number;
  className?: string;
}) {
  const { data } = useQuery({
    queryKey: ["wallet-balances", userId],
    queryFn: fetchMyWalletBalances,
    staleTime: 30_000,
  });
  const value = data?.[kind] ?? initial;
  return <span className={className}>{formatDA(value)}</span>;
}
