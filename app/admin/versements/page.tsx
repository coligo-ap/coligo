import { createAdminClient } from "@/lib/supabase/admin";
import {
  PayoutsManager,
  type MerchantPayout,
  type PartnerPayable,
} from "@/components/admin/payouts/payouts-manager";

export const dynamic = "force-dynamic";

// L'accès super-admin (+ MFA) est garanti par app/admin/layout.tsx.
export default async function AdminVersementsPage() {
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

  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string
  ) => Promise<{ data: unknown }>;

  const [payRes, partnersRes] = await Promise.all([
    sel("payout_requests")
      .select(
        "id, merchant_id, amount_da, status, method, details, processed_at, created_at, merchants(name)"
      )
      .order("created_at", { ascending: false })
      .limit(300),
    rpc("admin_partner_payables"),
  ]);

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

  const payouts: MerchantPayout[] = ((payRes.data as Raw[] | null) ?? []).map(
    (r) => {
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
    }
  );

  const partners = (partnersRes.data as PartnerPayable[] | null) ?? [];

  return <PayoutsManager payouts={payouts} partners={partners} />;
}
