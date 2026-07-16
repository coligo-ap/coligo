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
  /** La vérification automatique a REFUSÉ le dossier (recours possible). */
  rejected: boolean;
  /** Dossier basculé en vérification MANUELLE après un refus (mig 0371) :
   *  l'équipe Coligo décide sur pièces. */
  manualFallback: boolean;
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

/**
 * État de conformité IDV de l'utilisateur courant, pour un profil donné.
 *
 * Deux couches de fail-safe DÉLIBÉRÉMENT différentes :
 *  1. Configuration illisible (flag/règles du profil) → NON BLOQUANT. C'est
 *     une question de PRODUIT (la fonctionnalité s'applique-t-elle même ?),
 *     jamais celle d'un compte précis — y échouer ne doit pas mettre toute une
 *     flotte de partenaires à quai pour un blip de config sans rapport.
 *  2. Le gate confirme que la vérification est OBLIGATOIRE, mais le DOSSIER de
 *     CET utilisateur est illisible (timeout, panne) → BLOQUANT. Une fois
 *     établi qu'une identité vérifiée est exigée, un statut inconnu n'est
 *     JAMAIS traité comme conforme : c'est une exigence de conformité, pas un
 *     confort produit — aucune page, requête ou action ne doit laisser passer
 *     un compte dont on ne peut pas PROUVER l'identité. `getMyLatestIdvVerification`
 *     est borné (4 s) : cet échec reste rare et vite retenté, jamais un blocage
 *     muet (cf. IdvRequiredScreen, qui reste actionnable — lien + déconnexion).
 */
export const getIdvCompliance = cache(
  async (profile: IdvProfile): Promise<IdvCompliance> => {
    const route = ROUTES[profile] ?? "/";
    const notEnabled: IdvCompliance = {
      enabled: false,
      required: false,
      status: null,
      verified: false,
      inProgress: false,
      actionNeeded: false,
      rejected: false,
      manualFallback: false,
      route,
    };

    let gate;
    try {
      gate = await getIdvGate(profile);
    } catch {
      return notEnabled;
    }
    if (!gate.enabled) return notEnabled;

    // DERNIER dossier, approuvé/refusé compris (un dossier approuvé n'est plus
    // « vivant » : le lire via getMyIdvVerification renverrait null et on
    // redemanderait indéfiniment une vérification déjà faite). Un échec ICI ne
    // doit JAMAIS se lire comme « vérifié » — cf. commentaire ci-dessus.
    let verification: Awaited<ReturnType<typeof getMyLatestIdvVerification>> =
      null;
    try {
      verification = await getMyLatestIdvVerification(profile);
    } catch {
      verification = null;
    }
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
      rejected: status === "rejected",
      manualFallback: verification?.manual_fallback === true,
      route,
    };
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

/**
 * GARDE RÉUTILISABLE des envois de dossier (livreur, chauffeur, commerçant).
 * Renvoie `null` si l'envoi peut se faire, sinon le message à afficher.
 *
 * Un seul endroit décide : si le super-admin a rendu la vérification
 * OBLIGATOIRE pour ce profil et que l'identité n'est pas confirmée, le dossier
 * ne part pas. Une vérification EN COURS d'examen n'est pas une identité
 * confirmée : on le dit clairement plutôt que de laisser croire à un blocage.
 * Fonctionnalité non publiée ou seulement facultative ⇒ aucun effet.
 */
export async function idvSubmissionBlock(
  profile: IdvProfile,
  opts?: { method?: "manual" | "instant" | null }
): Promise<{ error: string; missing: string[] } | null> {
  const c = await getIdvCompliance(profile);
  if (!c.enabled || !c.required || c.verified) return null;
  // REPLI MANUEL (mig 0371) : la vérification automatique a refusé, l'utilisateur
  // a demandé l'examen par l'équipe Coligo. Son dossier PART — ce sont ses pièces
  // qui seront examinées. Sans cette porte, un refus à tort (document abîmé,
  // photo de nuit) enfermerait le livreur à vie.
  if (c.manualFallback && opts?.method === "manual") return null;
  return {
    error: c.inProgress
      ? "Votre identité est en cours de vérification. Vous pourrez transmettre votre dossier dès qu'elle sera confirmée."
      : "Vérifiez d'abord votre identité (document + selfie).",
    missing: ["Vérification d'identité"],
  };
}
