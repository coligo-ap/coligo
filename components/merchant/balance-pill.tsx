"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { formatDA } from "@/lib/utils";
import { getMyWalletState } from "@/app/wallet/recharge-actions";

/**
 * Pastille de solde du portefeuille commerçant — affichée dans l'en-tête,
 * rafraîchie ~20 s + au focus. Cliquable → page de recharge (/recharger).
 */
export function MerchantBalancePill({
  compact = false,
  variant = "header",
}: {
  compact?: boolean;
  /** "banner" : style clair sur fond violet (bandeau du dashboard). */
  variant?: "header" | "banner";
}) {
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

  if (variant === "banner") {
    return (
      <Link
        href="/recharger"
        prefetch
        aria-label="Coligo Pay — solde & recharge"
        title="Coligo Pay — solde & recharge"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/25"
      >
        <Wallet className="size-4" />
        <span className="hidden sm:inline">Coligo Pay</span>
        <span className="tabular-nums">
          {bal == null ? "…" : formatDA(bal)}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href="/recharger"
      aria-label="Mon solde — recharger"
      title="Mon solde — recharger"
      className={`border-border bg-surface-2 hover:bg-surface-3 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-bold transition-colors ${negative ? "text-danger-700" : "text-primary-700"}`}
    >
      <Wallet className="size-4" />
      {!compact && (
        <span className="text-muted hidden text-xs font-medium sm:inline">
          Solde
        </span>
      )}
      <span className="tabular-nums">{bal == null ? "…" : formatDA(bal)}</span>
    </Link>
  );
}
