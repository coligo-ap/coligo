import { BadgeCheck, Clock, Snowflake } from "lucide-react";

/**
 * Statut DE COMPTE d'un livreur, avec code couleur cohérent (liste + fiche) :
 *   • Gelé/bloqué → ROUGE (priorité absolue, l'accès est suspendu) ;
 *   • Vérifié    → VERT (compte actif et validé) ;
 *   • Non vérifié → AMBRE (en attente de validation des pièces).
 */
export type DriverStatusInput = {
  isFrozen?: boolean | null;
  isVerified?: boolean | null;
};

export function driverStatus({ isFrozen, isVerified }: DriverStatusInput) {
  if (isFrozen) {
    return {
      key: "frozen" as const,
      label: "Gelé",
      cls: "bg-danger-100 text-danger-700",
      dot: "bg-danger-600",
    };
  }
  if (isVerified) {
    return {
      key: "verified" as const,
      label: "Vérifié",
      cls: "bg-success-50 text-success-700",
      dot: "bg-success-600",
    };
  }
  return {
    key: "unverified" as const,
    label: "Non vérifié",
    cls: "bg-warning-50 text-warning-700",
    dot: "bg-warning-500",
  };
}

export function DriverStatusBadge({ isFrozen, isVerified }: DriverStatusInput) {
  const s = driverStatus({ isFrozen, isVerified });
  const Icon =
    s.key === "frozen" ? Snowflake : s.key === "verified" ? BadgeCheck : Clock;
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold " +
        s.cls
      }
    >
      <Icon className="size-3.5" />
      {s.label}
    </span>
  );
}
