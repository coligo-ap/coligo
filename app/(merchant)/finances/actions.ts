"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { payoutSchema } from "@/lib/validation/payout";
import { availableBalance } from "@/lib/finances/balance";
import { formatDA } from "@/lib/utils";
import type { PayoutStatus } from "@/lib/types";

export type PayoutFormState = {
  error?: string;
  ok?: boolean;
};

async function getCurrentMerchantId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  return merchant?.id ?? null;
}

/**
 * Demande de versement. NE crée AUCUNE écriture au ledger (le `payout` n'est
 * inscrit que lorsqu'il est réellement payé, côté admin). On vérifie ici, de
 * façon AUTORITAIRE côté serveur, que le solde disponible couvre le montant.
 */
export async function requestPayout(
  _prevState: PayoutFormState,
  formData: FormData
): Promise<PayoutFormState> {
  const parsed = payoutSchema.safeParse({
    amount_da: formData.get("amount_da"),
    method: formData.get("method"),
    details: formData.get("details"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }

  const merchantId = await getCurrentMerchantId();
  if (!merchantId) return { error: "Session expirée, reconnectez-vous." };

  const supabase = await createClient();

  // Solde disponible recalculé serveur (RLS = ses données) — jamais le client.
  const [{ data: entries }, { data: requests }] = await Promise.all([
    supabase.from("wallet_entries").select("amount_da"),
    supabase.from("payout_requests").select("amount_da, status"),
  ]);

  const available = availableBalance(
    entries ?? [],
    (requests ?? []) as { amount_da: number; status: PayoutStatus }[]
  );

  if (available <= 0) {
    return { error: "Aucun solde disponible pour un versement." };
  }
  if (parsed.data.amount_da > available) {
    return {
      error: `Montant supérieur au solde disponible (${formatDA(available)}).`,
    };
  }

  const { error } = await supabase.from("payout_requests").insert({
    merchant_id: merchantId,
    amount_da: parsed.data.amount_da,
    method: parsed.data.method,
    details: parsed.data.details,
    status: "pending",
  });

  if (error) {
    return { error: `Échec de la demande : ${error.message}` };
  }

  revalidatePath("/finances");
  return { ok: true };
}
