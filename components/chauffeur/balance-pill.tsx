"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet } from "lucide-react";
import { formatDA } from "@/lib/utils";
import { getMyWalletState } from "@/app/wallet/recharge-actions";

/**
 * Pastille de solde du portefeuille chauffeur — affichée en haut de l'accueil,
 * à côté de l'état « Hors ligne ». Se rafraîchit ~toutes les 20 s (temps réel)
 * et au retour de focus. Cliquable → page de recharge.
 */
export function ChauffeurBalancePill() {
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
      onClick={() => router.push("/chauffeur/recharger")}
      aria-label="Mon solde — recharger"
      className="absolute top-3 right-4 z-10 flex items-center gap-1.5 rounded-full bg-[var(--d-surface)] px-3 py-2 text-[13px] font-extrabold shadow-lg"
      style={{ color: negative ? "#E5484D" : "#6C2BD9" }}
    >
      <Wallet className="size-4" />
      {bal == null ? "…" : formatDA(bal)}
    </button>
  );
}
