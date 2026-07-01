import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";
import type { MerchantPayout } from "@/components/admin/payouts/payouts-manager";

// =============================================================================
// Demandes de versement des commerçants — source unique partagée entre la page
// Versements (/admin/versements, qui y ajoute les partenaires) et l'onglet
// « Versements » du hub Commerçants (/admin/merchants/finances).
// Accès service_role (createAdminClient) ; gate super-admin par le layout /admin.
// =============================================================================

export async function getMerchantPayouts(
  limit = 300
): Promise<MerchantPayout[]> {
  // Self-guard au point de convergence (lecture service_role partagée page + vue).
  // Non-admin ⇒ [] sans throw. Mémoïsé par requête → coût réseau nul.
  if (!(await isSuperAdmin())) return [];
  const admin = createAdminClient();

  const sel = (t: string) =>
    (
      admin.from as unknown as (t: string) => {
        select: (c: string) => {
          order: (
            c: string,
            o: { ascending: boolean }
          ) => {
            limit: (n: number) => Promise<{ data: unknown }>;
          };
        };
      }
    )(t);

  const payRes = await sel("payout_requests")
    .select(
      "id, merchant_id, amount_da, status, method, details, processed_at, created_at, merchants(name)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  type Raw = {
    id: string;
    merchant_id: string;
    amount_da: number;
    status: MerchantPayout["status"];
    method: string;
    details: string | null;
    processed_at: string | null;
    created_at: string;
    merchants: { name: string } | { name: string }[] | null;
  };

  return ((payRes.data as Raw[] | null) ?? []).map((r) => {
    const m = Array.isArray(r.merchants) ? r.merchants[0] : r.merchants;
    return {
      id: r.id,
      merchantName: m?.name ?? "Commerçant",
      amountDa: r.amount_da,
      status: r.status,
      method: r.method,
      details: r.details,
      createdAt: r.created_at,
      processedAt: r.processed_at,
    };
  });
}
