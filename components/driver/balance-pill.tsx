"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet } from "lucide-react";
import { formatDA } from "@/lib/utils";
import { getMyWalletState } from "@/app/wallet/recharge-actions";

/**
 * Pastille de solde du portefeuille livreur — en haut de l'accueil, à côté de
 * l'état en ligne. Rafraîchie ~20 s + au focus. Cliquable → page de recharge.
 */
export function DriverBalancePill() {
  const router = useRouter();
  const [bal, setBal] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const s = await getMyWalletState();
      if (active) setBal(s?.effectiveBalanceDa ?? 0);
    };
    void load();
    const id = setInterval(load, 20000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const negative = bal != null && bal < 0;

  return (
    <button
      type="button"
      onClick={() => router.push("/driver/recharger")}
      aria-label="Mon solde — recharger"
      className={`absolute top-3 right-3 z-20 flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[13px] font-bold shadow-lg ${negative ? "text-[var(--red)]" : "text-[var(--violet)]"}`}
    >
      <Wallet className="size-4" />
      {bal == null ? "…" : formatDA(bal)}
    </button>
  );
}
