"use server";

import { createClient } from "@/lib/supabase/server";

// =============================================================================
// Paiement du Pass Prioritaire par CARTE (Chargily). Le montant est IMPOSÉ par
// le serveur (priority_subscribe, mig 0210) — le client ne fournit rien. Le
// webhook (metadata.type = 'priority_sub') active l'abo via priority_sub_mark_paid.
// Partagé livreur + chauffeur ; `returnPath` = page de retour selon l'espace.
// =============================================================================
export async function subscribePriorityCard(
  returnPath: string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;

  const { data, error } = await rpc("priority_subscribe", {
    p_payment_method: "card",
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    error?: string;
    sub_id?: string;
    amount_da?: number;
  } | null;
  if (!row?.ok) return { ok: false, error: row?.error ?? "Échec" };

  try {
    const { createCheckout } = await import("@/lib/payments/chargily");
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
    if (!base) return { ok: false, error: "Paiement carte indisponible." };
    const safe = returnPath.startsWith("/") ? returnPath : "/";
    const checkout = await createCheckout({
      amount: row.amount_da ?? 0,
      successUrl: `${base}${safe}?prio=success`,
      failureUrl: `${base}${safe}?prio=failed`,
      webhookEndpoint: `${base}/api/chargily/webhook`,
      metadata: { type: "priority_sub", sub_id: row.sub_id ?? null },
      description: "Abonnement Prioritaire Coligo",
      locale: "fr",
    });
    return { ok: true, url: checkout.checkout_url };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Paiement carte indisponible.",
    };
  }
}
