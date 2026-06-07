/**
 * Montant que le LIVREUR doit encaisser en espèces auprès du client.
 *
 * Règle métier : une commande payée en ligne est PRÉPAYÉE — elle n'est même
 * visible/attribuée qu'une fois le paiement confirmé (gating Chargily, mig
 * 0068). Le livreur n'a donc RIEN à encaisser dessus → 0 DA. En cash, le client
 * règle la totalité (`total_da`) à la remise.
 */
export function cashToCollectDa(o: {
  payment_method: "cash" | "online";
  total_da: number | null;
}): number {
  return o.payment_method === "cash" ? (o.total_da ?? 0) : 0;
}

/** Vrai si la commande est déjà entièrement réglée (rien à encaisser). */
export function isPrepaid(o: { payment_method: "cash" | "online" }): boolean {
  return o.payment_method !== "cash";
}
