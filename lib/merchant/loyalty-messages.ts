/**
 * Codes structurés des RPC fidélité (mig 0454/0456) → messages caissier.
 * Module PUR partagé client/serveur — l'UI ne parse JAMAIS un texte, elle
 * mappe un code (règle « signaux structurés » du repo). Aucun détail
 * technique n'est montré à l'utilisateur.
 */

export const LOYALTY_ERROR_FR: Record<string, string> = {
  not_merchant: "Session expirée — reconnectez-vous.",
  feature_disabled: "Le programme de fidélité n'est pas encore ouvert.",
  no_program:
    "Aucun programme configuré — ouvrez l'onglet Fidélité pour le créer.",
  program_disabled: "Votre programme de fidélité est désactivé.",
  not_found: "Carte ou code fidélité inconnu.",
  blocked: "Carte bloquée — le client doit contacter Coligo.",
  cap_reached: "Plafond fidélité du jour atteint pour ce client.",
  invalid_amount: "Montant invalide.",
  invalid_operation: "Opération invalide — rescannez.",
  invalid_args: "Choisissez un bon OU un montant.",
  rate_limited: "Trop d'opérations rapprochées — patientez un instant.",
  insufficient: "Solde fidélité insuffisant.",
  voucher_not_found: "Bon introuvable sur ce compte.",
  voucher_used: "Ce bon a déjà été utilisé.",
  voucher_expired: "Ce bon a expiré.",
  order_not_completed: "Validez d'abord le retrait de la commande.",
  no_customer: "Commande sans compte client — scannez sa carte ou son QR.",
};

export function loyaltyErrorMessage(code: string | undefined | null): string {
  return (
    (code && LOYALTY_ERROR_FR[code]) ||
    "Opération impossible pour le moment. Réessayez."
  );
}
