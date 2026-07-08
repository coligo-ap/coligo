"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminCan } from "@/lib/auth/admin";

// =============================================================================
// Portefeuilles Coligo Pay — recherche unifiée (clients + opérateurs/agents),
// fiches (soldes + écritures) et AJUSTEMENT MOTIVÉ du wallet client
// (admin_customer_credit 0346 : append-only, jamais de solde négatif).
// Les crédits/gels OPÉRATEUR réutilisent creditWallet / setWalletStatus
// (app/admin/recharges/actions.ts) — rien n'est dupliqué.
// =============================================================================

type Rpc = (
  fn: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type WalletHit = {
  kind: "client" | "driver" | "chauffeur" | "merchant" | "partner";
  refId: string;
  name: string;
  phone: string | null;
  balanceDa: number;
  cashbackDa: number;
  status: string;
};

/** Recherche unifiée (RPC 0346, gardée admin_can('finances') côté SQL). */
export async function searchWallets(q: string): Promise<WalletHit[]> {
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;
  const { data } = await rpc("admin_search_wallets", {
    p_q: q,
    p_limit: 12,
  });
  return (
    (data ?? []) as {
      kind: WalletHit["kind"];
      ref_id: string;
      name: string;
      phone: string | null;
      balance_da: number;
      cashback_da: number;
      status: string;
    }[]
  ).map((r) => ({
    kind: r.kind,
    refId: r.ref_id,
    name: r.name,
    phone: r.phone,
    balanceDa: Number(r.balance_da ?? 0),
    cashbackDa: Number(r.cashback_da ?? 0),
    status: r.status,
  }));
}

// -----------------------------------------------------------------------------
// Fiches (lectures service_role AUTO-GARDÉES adminCan('finances') → null).
// -----------------------------------------------------------------------------

export type WalletEntry = {
  id: string;
  type: string;
  source?: string | null;
  amount_da: number;
  note: string | null;
  created_at: string;
};

export type CustomerWalletDetail = {
  customer: {
    id: string;
    full_name: string;
    phone: string | null;
    pay_handle: string | null;
    created_at: string;
  };
  topupDa: number;
  cashbackDa: number;
  entries: WalletEntry[];
  transfers: {
    id: string;
    direction: "in" | "out";
    other_name: string | null;
    amount_da: number;
    created_at: string;
  }[];
  payments: {
    id: string;
    merchant_name: string | null;
    amount_da: number;
    created_at: string;
  }[];
};

export async function getCustomerWalletDetail(
  customerId: string
): Promise<CustomerWalletDetail | null> {
  if (!(await adminCan("finances"))) return null;
  const admin = createAdminClient();

  const { data: customer } = await admin
    .from("customers")
    .select("id, full_name, phone, pay_handle, created_at")
    .eq("id", customerId)
    .maybeSingle();
  if (!customer) return null;

  const [
    { data: entries },
    { data: transfersOut },
    { data: transfersIn },
    { data: payments },
  ] = await Promise.all([
    admin
      .from("customer_wallet_entries")
      .select("id, type, source, amount_da, note, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("coligo_pay_transfers" as never)
      .select("id, recipient_customer_id, amount_da, created_at")
      .eq("sender_customer_id" as never, customerId as never)
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("coligo_pay_transfers" as never)
      .select("id, sender_customer_id, amount_da, created_at")
      .eq("recipient_customer_id" as never, customerId as never)
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("coligo_pay_payments" as never)
      .select("id, merchant_id, amount_da, created_at")
      .eq("customer_id" as never, customerId as never)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const rows = (entries ?? []) as WalletEntry[];
  const topupDa = rows
    .filter((e) => e.source === "topup")
    .reduce((s, e) => s + e.amount_da, 0);
  const cashbackDa = rows
    .filter((e) => e.source === "cashback")
    .reduce((s, e) => s + e.amount_da, 0);
  // Les 100 dernières écritures peuvent tronquer le solde → soldes EXACTS.
  const [{ data: allTopup }, { data: allCashback }] = await Promise.all([
    admin.rpc(
      "customer_topup_balance" as never,
      {
        p_customer_id: customerId,
      } as never
    ),
    admin.rpc(
      "customer_cashback_balance" as never,
      {
        p_customer_id: customerId,
      } as never
    ),
  ]);

  // Noms des contreparties (P2P + commerçants QR).
  const otherIds = [
    ...new Set([
      ...((transfersOut ?? []) as { recipient_customer_id: string }[]).map(
        (t) => t.recipient_customer_id
      ),
      ...((transfersIn ?? []) as { sender_customer_id: string }[]).map(
        (t) => t.sender_customer_id
      ),
    ]),
  ];
  const merchIds = [
    ...new Set(
      ((payments ?? []) as { merchant_id: string }[]).map((p) => p.merchant_id)
    ),
  ];
  const [{ data: others }, { data: merchs }] = await Promise.all([
    otherIds.length
      ? admin.from("customers").select("id, full_name").in("id", otherIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    merchIds.length
      ? admin.from("merchants").select("id, name").in("id", merchIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const otherName = new Map((others ?? []).map((c) => [c.id, c.full_name]));
  const merchName = new Map((merchs ?? []).map((m) => [m.id, m.name]));

  return {
    // pay_handle (colonne récente) hors types générés → cast local.
    customer: customer as unknown as CustomerWalletDetail["customer"],
    topupDa: Number(allTopup ?? topupDa),
    cashbackDa: Number(allCashback ?? cashbackDa),
    entries: rows,
    transfers: [
      ...(
        (transfersOut ?? []) as {
          id: string;
          recipient_customer_id: string;
          amount_da: number;
          created_at: string;
        }[]
      ).map((t) => ({
        id: t.id,
        direction: "out" as const,
        other_name: otherName.get(t.recipient_customer_id) ?? null,
        amount_da: t.amount_da,
        created_at: t.created_at,
      })),
      ...(
        (transfersIn ?? []) as {
          id: string;
          sender_customer_id: string;
          amount_da: number;
          created_at: string;
        }[]
      ).map((t) => ({
        id: t.id,
        direction: "in" as const,
        other_name: otherName.get(t.sender_customer_id) ?? null,
        amount_da: t.amount_da,
        created_at: t.created_at,
      })),
    ].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ),
    payments: (
      (payments ?? []) as {
        id: string;
        merchant_id: string;
        amount_da: number;
        created_at: string;
      }[]
    ).map((p) => ({
      id: p.id,
      merchant_name: merchName.get(p.merchant_id) ?? null,
      amount_da: p.amount_da,
      created_at: p.created_at,
    })),
  };
}

export type OperatorWalletDetail = {
  wallet: {
    id: string;
    owner_type: "driver" | "chauffeur" | "merchant" | "partner";
    owner_id: string;
    status: string;
    display_name: string | null;
    phone: string | null;
    is_partner: boolean;
  };
  ownerName: string;
  ownerPhone: string | null;
  balanceDa: number;
  debtDa: number;
  entries: WalletEntry[];
};

export async function getOperatorWalletDetail(
  walletId: string
): Promise<OperatorWalletDetail | null> {
  if (!(await adminCan("finances"))) return null;
  const admin = createAdminClient();

  const { data: wallet } = await admin
    .from("operator_wallets" as never)
    .select("id, owner_type, owner_id, status, display_name, phone, is_partner")
    .eq("id" as never, walletId as never)
    .maybeSingle<OperatorWalletDetail["wallet"]>();
  if (!wallet) return null;

  const rpc = admin.rpc.bind(admin) as unknown as Rpc;
  const [{ data: balance }, { data: debt }, { data: entries }] =
    await Promise.all([
      rpc("operator_balance", { p_wallet_id: walletId }),
      rpc("operator_role_debt", { p_wallet_id: walletId }),
      admin
        .from("operator_wallet_entries" as never)
        .select("id, type, amount_da, note, created_at")
        .eq("wallet_id" as never, walletId as never)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  let ownerName = wallet.display_name ?? "—";
  let ownerPhone: string | null = wallet.phone;
  if (wallet.owner_type === "driver") {
    const { data } = await admin
      .from("drivers")
      .select("full_name, phone")
      .eq("id", wallet.owner_id)
      .maybeSingle();
    ownerName = data?.full_name ?? ownerName;
    ownerPhone = data?.phone ?? ownerPhone;
  } else if (wallet.owner_type === "chauffeur") {
    const { data } = await admin
      .from("chauffeurs")
      .select("full_name, phone")
      .eq("id", wallet.owner_id)
      .maybeSingle();
    ownerName = data?.full_name ?? ownerName;
    ownerPhone = data?.phone ?? ownerPhone;
  } else if (wallet.owner_type === "merchant") {
    const { data } = await admin
      .from("merchants")
      .select("name")
      .eq("id", wallet.owner_id)
      .maybeSingle();
    ownerName = data?.name ?? ownerName;
  }

  return {
    wallet,
    ownerName,
    ownerPhone,
    balanceDa: Number(balance ?? 0),
    debtDa: Number(debt ?? 0),
    entries: (entries ?? []) as unknown as WalletEntry[],
  };
}

// -----------------------------------------------------------------------------
// Ajustement client (audité + notifié).
// -----------------------------------------------------------------------------

export async function adminAdjustCustomerWallet(input: {
  customerId: string;
  amountDa: number; // signé
  source: "topup" | "cashback";
  reason: string;
}): Promise<{ ok?: boolean; error?: string }> {
  if (!(await adminCan("finances"))) return { error: "Accès refusé." };
  const amt = Math.trunc(Number(input.amountDa));
  if (!Number.isFinite(amt) || amt === 0 || Math.abs(amt) > 100000) {
    return { error: "Montant invalide (± 100 000 DA max, non nul)." };
  }
  const reason = input.reason?.trim();
  if (!reason) return { error: "Le motif est obligatoire." };

  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;
  const { data, error } = await rpc("admin_customer_credit", {
    p_customer_id: input.customerId,
    p_amount_da: amt,
    p_source: input.source,
    p_note: reason,
  });
  if (error) return { error: error.message };
  const res = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    balance_da?: number;
    new_balance_da?: number;
  };
  if (!res.ok) {
    const map: Record<string, string> = {
      forbidden: "Accès refusé.",
      bad_amount: "Montant invalide (± 100 000 DA max, non nul).",
      bad_source: "Source invalide.",
      note_required: "Le motif est obligatoire.",
      customer_not_found: "Client introuvable.",
      insufficient_balance: `Débit refusé : solde insuffisant (${res.balance_da ?? 0} DA).`,
    };
    return { error: map[res.reason ?? ""] ?? "Ajustement impossible." };
  }

  // Audit (avant/après + IP).
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const h = await headers();
    const from = supabase.from.bind(supabase) as unknown as (t: string) => {
      insert: (v: Record<string, unknown>) => Promise<{ error: unknown }>;
    };
    await from("admin_audit_log").insert({
      admin_email: user?.email ?? null,
      action: amt > 0 ? "credit_customer_wallet" : "debit_customer_wallet",
      target_kind: "customer",
      target_id: input.customerId,
      note: reason,
      old_value: { balance_da: (res.new_balance_da ?? 0) - amt },
      new_value: {
        balance_da: res.new_balance_da ?? null,
        amount_da: amt,
        source: input.source,
      },
      ip:
        h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        h.get("x-real-ip") ||
        null,
    });
  } catch {
    /* l'audit ne doit jamais faire échouer l'action métier */
  }

  try {
    const { notifyCustomerWalletAdjusted } = await import("@/lib/fcm/triggers");
    await notifyCustomerWalletAdjusted({
      customerId: input.customerId,
      amountDa: amt,
      source: input.source,
    });
  } catch {
    /* noop */
  }

  revalidatePath(`/admin/coligo-pay/portefeuilles/client/${input.customerId}`);
  return { ok: true };
}
