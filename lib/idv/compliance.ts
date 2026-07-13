import { cache } from "react";
import { getIdvGate } from "./config";
import { getMyLatestIdvVerification } from "./user-data";
import type { IdvProfile, IdvStatus } from "./types";

// =============================================================================
// IDV — CONFORMITÉ d'un espace (étape 9). Répond à : « cet utilisateur peut-il
// continuer à travailler, ou doit-il d'abord vérifier son identité ? »
//
// Trois curseurs, tous pilotés par le super-admin sans toucher au code :
//   • fonctionnalité publiée (feature flag) ;
//   • exigence du profil : obligatoire / facultatif / désactivé ;
//   • état du dossier de CET utilisateur.
//
// Fail-safe : toute erreur de lecture ⇒ on NE bloque PAS (la vérification est
// une exigence produit, pas une barrière qui doit tomber en panne fermée sur
// un incident — un livreur ne doit jamais rester à quai pour ça).
// =============================================================================

export type IdvCompliance = {
  /** Le parcours est proposable (flag publié + profil non désactivé). */
  enabled: boolean;
  /** L'accès à l'espace est conditionné à une identité vérifiée. */
  required: boolean;
  /** Statut du dossier (null = pas encore commencé). */
  status: IdvStatus | null;
  /** Identité confirmée. */
  verified: boolean;
  /** Un dossier est en cours (analyse ou revue humaine). */
  inProgress: boolean;
  /** L'utilisateur doit AGIR (déposer / reprendre une pièce). */
  actionNeeded: boolean;
  /** Route du parcours pour ce profil. */
  route: string;
};

const ROUTES: Record<string, string> = {
  driver: "/driver/identite",
  chauffeur: "/chauffeur/identite",
  merchant: "/identite",
};

/** Statuts où la balle est dans le camp de l'utilisateur. */
const NEEDS_USER_ACTION: IdvStatus[] = [
  "draft",
  "doc_validated",
  "resubmit_document",
  "resubmit_selfie",
  "rejected",
];

/** État de conformité IDV de l'utilisateur courant, pour un profil donné. */
export const getIdvCompliance = cache(
  async (profile: IdvProfile): Promise<IdvCompliance> => {
    const route = ROUTES[profile] ?? "/";
    try {
      const gate = await getIdvGate(profile);
      if (!gate.enabled) {
        return {
          enabled: false,
          required: false,
          status: null,
          verified: false,
          inProgress: false,
          actionNeeded: false,
          route,
        };
      }
      // DERNIER dossier, approuvé/refusé compris (un dossier approuvé n'est
      // plus « vivant » : le lire via getMyIdvVerification renverrait null et
      // on redemanderait indéfiniment une vérification déjà faite).
      const verification = await getMyLatestIdvVerification(profile);
      const status = verification?.status ?? null;
      return {
        enabled: true,
        required: gate.requirement === "required",
        status,
        verified: status === "approved",
        inProgress:
          status === "doc_processing" ||
          status === "selfie_processing" ||
          status === "pending_review",
        actionNeeded: status === null || NEEDS_USER_ACTION.includes(status),
        route,
      };
    } catch {
      return {
        enabled: false,
        required: false,
        status: null,
        verified: false,
        inProgress: false,
        actionNeeded: false,
        route,
      };
    }
  }
);

/**
 * L'accès à l'espace doit-il être BLOQUÉ ? (vérification rendue obligatoire
 * par le super-admin et identité non confirmée).
 *
 * ⚠️ On ne redirige PAS : l'appelant REND un écran bloquant à la place du
 * contenu (composant `IdvRequiredScreen`, même pattern que les comptes
 * bloqués/gelés). Un `redirect()` depuis une page streamée sous `loading.tsx`
 * casse l'hydratation en production (React #310 — piège vécu, mesuré sur
 * toutes les pages du livreur avant correction).
 */
export async function idvBlocksAccess(profile: IdvProfile): Promise<boolean> {
  const c = await getIdvCompliance(profile);
  return c.enabled && c.required && !c.verified;
}

/** Route du parcours IDV d'un profil (pour l'écran bloquant). */
export function idvRouteFor(profile: IdvProfile): string {
  return ROUTES[profile] ?? "/";
}
