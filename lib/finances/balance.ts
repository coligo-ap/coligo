// =============================================================================
// Calculs de solde — fonctions PURES (le solde n'est jamais stocké).
// =============================================================================
// Solde = somme des écritures du ledger. Le « disponible » retire en plus les
// demandes de versement en cours (pending/approved) qui ne sont pas encore au
// ledger : on évite ainsi qu'un commerçant demande deux fois le même argent.

import {
  isPayoutReserving,
  type PayoutRequest,
  type WalletEntry,
} from "@/lib/types";

/** Solde courant = SUM(amount_da). */
export function walletBalance(
  entries: Pick<WalletEntry, "amount_da">[]
): number {
  return entries.reduce((sum, e) => sum + e.amount_da, 0);
}

/** Montant « gelé » par les demandes en cours (pending/approved). */
export function reservedAmount(
  requests: Pick<PayoutRequest, "amount_da" | "status">[]
): number {
  return requests.reduce(
    (sum, r) => (isPayoutReserving(r.status) ? sum + r.amount_da : sum),
    0
  );
}

/** Solde réellement disponible pour un nouveau versement. */
export function availableBalance(
  entries: Pick<WalletEntry, "amount_da">[],
  requests: Pick<PayoutRequest, "amount_da" | "status">[]
): number {
  return walletBalance(entries) - reservedAmount(requests);
}

/** Totaux par type (pour la carte de résumé : gains, commissions, versés). */
export function sumByType(
  entries: Pick<WalletEntry, "amount_da" | "type">[],
  type: WalletEntry["type"]
): number {
  return entries.reduce(
    (sum, e) => (e.type === type ? sum + e.amount_da : sum),
    0
  );
}
