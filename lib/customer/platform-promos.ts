// =============================================================================
// Codes promo PLATEFORME + bons d'achat du client connecté (côté SERVEUR).
// =============================================================================
// Les codes plateforme (mig 0292) sont financés par Coligo et valables chez tous
// les commerçants (paiement en ligne en v1). Les bons (mig 0293) créditent le
// portefeuille Coligo Pay. Lecture via RLS / RPC SECURITY DEFINER (le client ne
// voit que ce qui le concerne).
//
// Ces tables/RPC ne sont pas (encore) dans database.types.ts généré → accès
// casté localement, comme ailleurs dans le projet.
// =============================================================================

import { createClient } from "@/lib/supabase/server";

export type PlatformPromoCode = {
  id: string;
  code: string;
  title_fr: string;
  title_ar: string | null;
  description_fr: string | null;
  description_ar: string | null;
  discount_kind: "percent" | "amount";
  discount_value: number;
  max_discount_da: number | null;
  min_subtotal_da: number | null;
  ends_at: string | null;
  online_only: boolean;
  max_uses_per_customer: number | null;
  used_by_me: number;
};

export type CustomerVoucher = {
  id: string;
  amount_da: number;
  label_fr: string | null;
  label_ar: string | null;
  reason: "gift" | "loyalty" | "compensation" | "campaign";
  status: "granted" | "revoked";
  created_at: string;
};

/** Codes plateforme disponibles pour le client (audience 'all' + publics listés
 *  + ceux qui lui sont attribués), avec son nombre d'usages. */
export async function getMyPlatformCodes(): Promise<PlatformPromoCode[]> {
  const supabase = await createClient();
  const { data } = await (
    supabase.rpc as unknown as (
      fn: string
    ) => PromiseLike<{ data: PlatformPromoCode[] | null }>
  )("get_my_platform_codes");
  return (data ?? []) as PlatformPromoCode[];
}

/** Bons d'achat reçus par le client (crédités sur Coligo Pay), récents d'abord. */
export async function getMyVouchers(): Promise<CustomerVoucher[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!customer) return [];

  const { data } = await (
    supabase.from("customer_vouchers" as never) as unknown as {
      select: (c: string) => {
        eq: (
          c: string,
          v: string
        ) => {
          order: (
            c: string,
            o: { ascending: boolean }
          ) => PromiseLike<{ data: CustomerVoucher[] | null }>;
        };
      };
    }
  )
    .select("id, amount_da, label_fr, label_ar, reason, status, created_at")
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false });

  return (data ?? []) as CustomerVoucher[];
}
