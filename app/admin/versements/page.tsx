import { createAdminClient } from "@/lib/supabase/admin";
import {
  PayoutsManager,
  type PartnerPayable,
} from "@/components/admin/payouts/payouts-manager";
import { getMerchantPayouts } from "@/lib/data/admin-payouts";

export const dynamic = "force-dynamic";

// L'accès super-admin (+ MFA) est garanti par app/admin/layout.tsx.
export default async function AdminVersementsPage() {
  const admin = createAdminClient();

  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string
  ) => Promise<{ data: unknown }>;

  const [payouts, partnersRes] = await Promise.all([
    getMerchantPayouts(),
    rpc("admin_partner_payables"),
  ]);

  const partners = (partnersRes.data as PartnerPayable[] | null) ?? [];

  return <PayoutsManager payouts={payouts} partners={partners} />;
}
