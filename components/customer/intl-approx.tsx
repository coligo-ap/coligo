"use client";

import { useEffect, useState } from "react";
import { estimateIntlEur } from "@/app/(customer)/checkout/intl-actions";
import { eurLabel } from "@/components/customer/intl-payment-sheet";

// =============================================================================
// IntlApproxTag — « ≈ 15,20 € » en petit sur le bouton de confirmation
// (façon Uber/Bolt) quand la carte internationale est sélectionnée : le
// client sait AVANT de confirmer combien sa carte sera débitée. Debounce
// 350 ms (le total bouge avec les soldes/promos) ; seul le MONTANT circule
// (jamais le taux) ; le montant autoritaire reste celui figé serveur à la
// création du paiement. Rien ne s'affiche tant que l'estimation n'est pas là.
// =============================================================================

export function IntlApproxTag({
  totalDa,
  className,
}: {
  totalDa: number;
  className?: string;
}) {
  const [cents, setCents] = useState<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(totalDa) || totalDa <= 0) {
      setCents(null);
      return;
    }
    let alive = true;
    const id = setTimeout(() => {
      void estimateIntlEur(totalDa).then((c) => {
        if (alive) setCents(c);
      });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [totalDa]);

  if (cents == null) return null;
  return <span className={className}>≈ {eurLabel(cents)}</span>;
}
