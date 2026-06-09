import { Ban, BadgeCheck, Clock, CheckCircle2, Snowflake } from "lucide-react";

/**
 * Statut DE COMPTE d'un livreur, avec code couleur cohérent (liste + fiche).
 * Deux dimensions INDÉPENDANTES affichées côte à côte :
 *
 *  1. État du compte (priorité d'accès) :
 *       • Bloqué  → ROUGE  (aucun accès — sanction dure) ;
 *       • Gelé    → AMBRE  (accès au compte mais activité suspendue) ;
 *       • Actif   → VERT   (rien à signaler).
 *  2. Vérification : tant que le compte n'est PAS vérifié, on affiche
 *     TOUJOURS un badge « Non vérifié » (en plus de l'état ci-dessus).
 */
export type DriverStatusInput = {
  isBlocked?: boolean | null;
  isFrozen?: boolean | null;
  isVerified?: boolean | null;
};

export function accountState({ isBlocked, isFrozen }: DriverStatusInput) {
  if (isBlocked) {
    return {
      key: "blocked" as const,
      label: "Bloqué",
      cls: "bg-danger-100 text-danger-700",
      Icon: Ban,
    };
  }
  if (isFrozen) {
    return {
      key: "frozen" as const,
      label: "Gelé",
      cls: "bg-warning-100 text-warning-800",
      Icon: Snowflake,
    };
  }
  return {
    key: "active" as const,
    label: "Actif",
    cls: "bg-success-50 text-success-700",
    Icon: CheckCircle2,
  };
}

export function DriverStatusBadge({
  isBlocked,
  isFrozen,
  isVerified,
}: DriverStatusInput) {
  const st = accountState({ isBlocked, isFrozen });
  const pill =
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={pill + " " + st.cls}>
        <st.Icon className="size-3.5" />
        {st.label}
      </span>
      {isVerified ? (
        <span className={pill + " bg-success-50 text-success-700"}>
          <BadgeCheck className="size-3.5" />
          Vérifié
        </span>
      ) : (
        <span className={pill + " bg-warning-50 text-warning-700"}>
          <Clock className="size-3.5" />
          Non vérifié
        </span>
      )}
    </span>
  );
}
