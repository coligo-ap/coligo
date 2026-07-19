"use server";

import { createClient } from "@/lib/supabase/server";

export type MyWalletState = {
  walletId: string;
  ownerType: "driver" | "chauffeur" | "merchant" | "partner" | string;
  status: string;
  balanceDa: number;
  debtDa: number;
  effectiveBalanceDa: number;
  negThresholdDa: number;
  canOperate: boolean;
  isPartner: boolean;
};

export type TopupConfig = {
  ccpNumber: string | null;
  ccpKey: string | null;
  ccpName: string | null;
  bankName: string | null;
  bankRib: string | null;
  presets: number[];
  maxDa: number;
};

export type MyWalletEntry = {
  id: string;
  type: string;
  amountDa: number;
  note: string | null;
  createdAt: string;
};

/** Détail d'une écriture (page « reçu ») — inclut la référence liée. */
export type MyWalletEntryDetail = MyWalletEntry & {
  refId: string | null;
};

/** État du portefeuille opérateur de l'utilisateur connecté. */
export async function getMyWalletState(): Promise<MyWalletState | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_operator_wallet_state");
  const r = Array.isArray(data) ? data[0] : null;
  if (!r) return null;
  return {
    walletId: r.wallet_id,
    ownerType: r.owner_type,
    status: r.status,
    balanceDa: r.balance_da,
    debtDa: r.debt_da,
    effectiveBalanceDa: r.effective_balance_da,
    negThresholdDa: r.neg_threshold_da,
    canOperate: r.can_operate,
    isPartner: r.is_partner,
  };
}

/**
 * Config de recharge : CCP de la plateforme (réutilise le compte Drive),
 * montants suggérés et plafond — tout en config admin, jamais en dur.
 */
export async function getMyTopupConfig(): Promise<TopupConfig> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("operator_topup_config");
  const r = Array.isArray(data) ? data[0] : null;
  return {
    ccpNumber: r?.ccp_number ?? null,
    ccpKey: r?.ccp_key ?? null,
    ccpName: r?.ccp_name ?? null,
    bankName: r?.bank_name ?? null,
    bankRib: r?.bank_rib ?? null,
    presets:
      r?.presets_da && r.presets_da.length > 0
        ? r.presets_da
        : [500, 1000, 2000, 5000],
    maxDa: r?.max_da ?? 100000,
  };
}

/** Historique des écritures du portefeuille opérateur (RPC scopée auth.uid).
 *  `limit` borné serveur [1..200] → « voir plus » progressif côté page. */
export async function getMyWalletEntries(limit = 20): Promise<MyWalletEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_operator_wallet_entries", {
    p_limit: Math.min(200, Math.max(1, Math.round(limit))),
  });
  const rows = (data ?? []) as {
    id: string;
    type: string;
    amount_da: number;
    note: string | null;
    created_at: string;
  }[];
  return rows.map((e) => ({
    id: e.id,
    type: e.type,
    amountDa: e.amount_da,
    note: e.note,
    createdAt: e.created_at,
  }));
}

/** Une écriture précise (page détail « reçu ») — self-only via la RPC. */
export async function getMyWalletEntry(
  id: string
): Promise<MyWalletEntryDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_operator_wallet_entry", {
    p_id: id,
  });
  const r = Array.isArray(data) ? data[0] : null;
  if (!r) return null;
  return {
    id: r.id,
    type: r.type,
    amountDa: r.amount_da,
    note: r.note,
    refId: r.ref_id ?? null,
    createdAt: r.created_at,
  };
}

/** Crée un checkout Chargily pour recharger le portefeuille (carte). */
export async function createOperatorTopupCheckout(
  amountDa: number,
  returnPath: string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!Number.isFinite(amountDa) || amountDa < 100)
    return { ok: false, error: "Montant minimum : 100 DA." };
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_operator_wallet_state");
  const wallet = Array.isArray(data) ? data[0] : null;
  if (!wallet) return { ok: false, error: "Aucun portefeuille." };

  try {
    const { createCheckout } = await import("@/lib/payments/chargily");
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
    if (!base) return { ok: false, error: "Paiement carte indisponible." };
    const safePath = returnPath.startsWith("/") ? returnPath : `/${returnPath}`;
    const checkout = await createCheckout({
      amount: Math.round(amountDa),
      successUrl: `${base}${safePath}?topup=success`,
      failureUrl: `${base}${safePath}?topup=failed`,
      webhookEndpoint: `${base}/api/chargily/webhook`,
      metadata: {
        type: "op_topup",
        wallet_id: wallet.wallet_id,
        amount_da: Math.round(amountDa),
      },
      description: "Recharge portefeuille Coligo",
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

/** Crée une demande de recharge manuelle (preuve déjà téléversée → chemin). */
export async function requestOperatorManualTopup(input: {
  method: "ccp" | "virement";
  amountDa: number;
  proofPath: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_operator_topup", {
    p_method: input.method,
    p_amount_da: Math.round(input.amountDa),
    p_proof_url: input.proofPath,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
