// =============================================================================
// Reçus de paiement (mig 0394) — écriture depuis les webhooks
// =============================================================================
// Une ligne par paiement réel, avec le fournisseur, le statut, l'horodatage et
// les infos carte NON SENSIBLES (marque, 4 derniers chiffres, Apple/Google
// Pay). C'est ce que lit l'historique client : avant, « payé en ligne » ne
// disait ni par quoi ni avec quelle carte.
//
// Fire-and-forget par principe : un reçu manquant ne doit JAMAIS faire échouer
// un webhook de paiement (le crédit/l'encaissement prime sur la traçabilité).
// L'idempotence est portée par la contrainte UNIQUE (provider, external_id).
// =============================================================================

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type ReceiptInput = {
  kind: "order" | "ride" | "topup";
  provider: "stripe" | "chargily";
  /** PaymentIntent Stripe ou checkout Chargily. */
  externalId: string;
  status: "paid" | "failed" | "refunded";
  amountDa: number;
  customerId?: string | null;
  orderId?: string | null;
  rideId?: string | null;
  eurCents?: number | null;
  cardBrand?: string | null;
  cardLast4?: string | null;
  wallet?: string | null;
  /** 'cib' | 'edahabia' | 'card'. */
  method?: string | null;
};

export async function recordPaymentReceipt(input: ReceiptInput): Promise<void> {
  try {
    if (!input.externalId || input.amountDa <= 0) return;
    const admin = createAdminClient();
    // `.bind` requis (rpc détaché perd son `this`) ; jamais `.catch` sur le
    // builder Supabase — await direct, l'erreur revient dans `{ error }`.
    const rpc = admin.rpc.bind(admin) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ error: { message: string } | null }>;
    const { error } = await rpc("record_payment_receipt", {
      p_kind: input.kind,
      p_provider: input.provider,
      p_external_id: input.externalId,
      p_status: input.status,
      p_amount_da: Math.round(input.amountDa),
      p_customer_id: input.customerId ?? null,
      p_order_id: input.orderId ?? null,
      p_ride_id: input.rideId ?? null,
      p_eur_cents: input.eurCents ?? null,
      p_card_brand: input.cardBrand ?? null,
      p_card_last4: input.cardLast4 ?? null,
      p_wallet: input.wallet ?? null,
      p_method: input.method ?? null,
    });
    if (error) console.warn("[receipts] écriture échouée:", error.message);
  } catch (err) {
    console.warn("[receipts] exception ignorée:", err);
  }
}

/** Reçu d'un paiement Stripe : va chercher les détails carte puis enregistre. */
export async function recordStripeReceipt(
  input: Omit<ReceiptInput, "provider" | "cardBrand" | "cardLast4" | "wallet">
): Promise<void> {
  const { fetchCardDetails } = await import("@/lib/payments/stripe");
  const card = await fetchCardDetails(input.externalId);
  await recordPaymentReceipt({
    ...input,
    provider: "stripe",
    cardBrand: card?.brand ?? null,
    cardLast4: card?.last4 ?? null,
    wallet: card?.wallet ?? null,
    method: "card",
  });
}
