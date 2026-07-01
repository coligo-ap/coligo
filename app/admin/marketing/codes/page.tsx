import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/admin";
import {
  PlatformCodesManager,
  type AdminPlatformCode,
  type AdminRedemption,
} from "@/components/admin/marketing/platform-codes-manager";

export const dynamic = "force-dynamic";

// =============================================================================
// Onglet « Codes promo » du hub Marketing — codes plateforme (mig 0292).
// Gate super-admin via app/admin/layout.tsx ET self-guard ici : lecture
// service_role (bypass RLS) exposant des PII clients (usages) → jamais lue hors
// d'une session super-admin (mémoïsé par requête, coût réseau nul).
// =============================================================================
export default async function MarketingCodesTab() {
  await requireSuperAdmin();
  const admin = createAdminClient();

  const { data: codes } = await (
    admin.from as unknown as (t: string) => {
      select: (c: string) => {
        order: (
          col: string,
          o: { ascending: boolean }
        ) => Promise<{ data: AdminPlatformCode[] | null }>;
      };
    }
  )("platform_promotions")
    .select(
      "id, code, title_fr, title_ar, description_fr, description_ar, discount_kind, discount_value, max_discount_da, min_subtotal_da, starts_at, ends_at, max_uses, max_uses_per_customer, uses_count, online_only, audience, is_listed, active, created_at"
    )
    .order("created_at", { ascending: false });

  // Journal des usages (récent), joint au client + commande pour la traçabilité.
  const { data: redemptions } = await (
    admin.from as unknown as (t: string) => {
      select: (c: string) => {
        order: (
          col: string,
          o: { ascending: boolean }
        ) => {
          limit: (n: number) => Promise<{ data: AdminRedemption[] | null }>;
        };
      };
    }
  )("platform_promotion_redemptions")
    .select(
      "id, promotion_id, order_id, code, discount_da, created_at, customers(full_name, phone), orders(pickup_code)"
    )
    .order("created_at", { ascending: false })
    .limit(300);

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-6">
      <header className="mb-5">
        <h1 className="text-foreground text-xl font-extrabold">
          Codes promo plateforme
        </h1>
        <p className="text-muted mt-1 text-sm">
          Codes financés par Coligo, valables chez tous les commerçants
          (paiement en ligne). La remise réduit ce que paie le client, pas le
          net versé au commerçant. Suivi des usages par code ci-dessous.
        </p>
      </header>

      <PlatformCodesManager
        codes={codes ?? []}
        redemptions={redemptions ?? []}
      />
    </div>
  );
}
