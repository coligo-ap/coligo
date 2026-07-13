// =============================================================================
// IDV — état d'interface du parcours de vérification, et LA règle métier qui en
// découle. Module PUR (aucun import serveur, aucun composant) : il est appelé
// aussi bien par les Server Components (bannières) que par les écrans client
// (inscription livreur, documents chauffeur).
//
// PIÈGE ÉVITÉ ICI : une fonction exportée depuis un module « use client » ne
// peut PAS être appelée côté serveur — elle y devient une simple référence
// client, et le rendu casse. C'est pour cela que ces fonctions vivent ici et
// non dans components/idv/idv-verify-step.tsx.
// =============================================================================

export type IdvMethod = "manual" | "instant";

/** État du parcours de vérification, tel que le serveur le voit. */
export type IdvChoiceState = {
  /** La vérification automatique est-elle publiée pour ce profil ? */
  available: boolean;
  /** Rendue OBLIGATOIRE par l'équipe Coligo → aucun choix possible. */
  forced: boolean;
  /** Voie retenue, `null` tant que rien n'a été choisi. */
  method: IdvMethod | null;
  /** Identité confirmée par le parcours automatique. */
  verified: boolean;
  /** Dossier en cours d'analyse ou de revue humaine. */
  inProgress: boolean;
  /** Route du parcours de vérification (propre à l'espace). */
  route: string;
  /** Dernière tentative refusée (le parcours reste ouvert : on peut réessayer). */
  rejected?: boolean;
};

export type IdvGate = {
  /** Voie effective : instantanée (choisie ou imposée), manuelle, ou aucune. */
  path: "instant" | "manual" | "none";
  /** L'avancement est-il BLOQUÉ par la vérification ? */
  blocked: boolean;
  /** Ce que doit faire LE bouton unique. `null` ⇒ le bouton de l'écran. */
  action: "verify" | "refresh" | null;
};

/**
 * LA règle métier, écrite une seule fois : on ne peut pas avancer sans identité
 * prouvée. Le bouton unique et les formulaires la lisent tous les deux —
 * impossible qu'un espace laisse passer ce qu'un autre bloque.
 */
export function idvGate(
  idv: IdvChoiceState,
  method: IdvMethod | null
): IdvGate {
  const effective: IdvMethod | null = idv.forced ? "instant" : method;
  if (!idv.available || effective !== "instant")
    return {
      path: effective === "manual" ? "manual" : "none",
      blocked: false,
      action: null,
    };
  if (idv.verified) return { path: "instant", blocked: false, action: null };
  return {
    path: "instant",
    blocked: true,
    action: idv.inProgress ? "refresh" : "verify",
  };
}

/** Traduit l'état serveur (`getIdvCompliance`) en état d'interface. */
export function idvStateOf(c: {
  enabled: boolean;
  required: boolean;
  verified: boolean;
  inProgress: boolean;
  status: string | null;
  route: string;
}): IdvChoiceState {
  return {
    available: c.enabled,
    forced: c.required,
    // Les écrans qui utilisent ceci n'offrent aucun dépôt de pièces : la voie
    // est forcément l'automatique.
    method: "instant",
    verified: c.verified,
    inProgress: c.inProgress,
    rejected: c.status === "rejected",
    route: c.route,
  };
}
