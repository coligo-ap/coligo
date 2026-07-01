import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/admin";
import {
  VouchersManager,
  type AdminVoucher,
} from "@/components/admin/marketing/vouchers-manager";

export const dynamic = "force-dynamic";

// =============================================================================
// Onglet « Bons d'achat » du hub Marketing — vouchers (mig 0293).
// Émission → crédit Coligo Pay du client. Gate super-admin via le layout admin
// ET self-guard ici : lecture service_role exposant des PII clients (mémoïsé,
// coût réseau nul).
// =============================================================================
export default async function MarketingVouchersTab() {
  await requireSuperAdmin();
  const admin = createAdminClient();

  const { data: vouchers } = await (
    admin.from as unknown as (t: string) => {
      select: (c: string) => {
        order: (
          col: string,
          o: { ascending: boolean }
        ) => {
          limit: (n: number) => Promise<{ data: AdminVoucher[] | null }>;
        };
      };
    }
  )("customer_vouchers")
    .select(
      "id, amount_da, label_fr, reason, status, batch_id, created_at, customers(full_name, phone)"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-6">
      <header className="mb-5">
        <h1 className="text-foreground text-xl font-extrabold">
          Bons d&apos;achat
        </h1>
        <p className="text-muted mt-1 text-sm">
          Un bon crédite directement le portefeuille Coligo Pay du client
          (cadeau, fidélité, dédommagement, campagne). La plateforme finance —
          chaque émission est tracée dans le grand livre.
        </p>
      </header>

      <VouchersManager vouchers={vouchers ?? []} />
    </div>
  );
}
