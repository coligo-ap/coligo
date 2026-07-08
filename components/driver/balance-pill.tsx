"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { formatDA } from "@/lib/utils";
import { getMyWalletState } from "@/app/wallet/recharge-actions";

/**
 * Pastille de solde du portefeuille livreur — en haut de l'accueil. Lue via
 * TanStack Query (clé par livreur) : le solde se réaffiche INSTANTANÉMENT depuis
 * le cache au retour sur l'accueil, et se rafraîchit ~20 s + au focus. Cliquable
 * → page de recharge. (Auth + RLS appliqués par getMyWalletState.)
 */
function useDriverBalance(driverId: string) {
  return useQuery({
    queryKey: ["driver-wallet", driverId],
    queryFn: async () => (await getMyWalletState())?.effectiveBalanceDa ?? 0,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

/**
 * Montant SEUL (texte, sans pilule ni ombre) — pour les cartes uniformes
 * (tiroir, listes) : même clé de cache que la pastille → zéro requête en plus.
 * Rouge si solde négatif.
 */
export function DriverBalanceAmount({ driverId }: { driverId: string }) {
  const { data: bal } = useDriverBalance(driverId);
  const negative = bal != null && bal < 0;
  return (
    <span style={negative ? { color: "var(--red)" } : undefined}>
      {bal == null ? "…" : formatDA(bal)}
    </span>
  );
}

export function DriverBalancePill({ driverId }: { driverId: string }) {
  const router = useRouter();
  const { data: bal } = useDriverBalance(driverId);

  const negative = bal != null && bal < 0;

  return (
    <button
      type="button"
      onClick={() => router.push("/driver/recharger")}
      aria-label="Mon solde — recharger"
      className={`flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[13px] font-bold shadow-lg ${negative ? "text-[var(--red)]" : "text-[var(--violet)]"}`}
    >
      <Wallet className="size-4" />
      {bal == null ? "…" : formatDA(bal)}
    </button>
  );
}
