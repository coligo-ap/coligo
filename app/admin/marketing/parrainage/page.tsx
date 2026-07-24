import { requireAdminDomain } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import {
  ReferralManager,
  type AdminReferralRow,
  type AdminReferralStats,
  type AdminReferralSettings,
} from "@/components/admin/referral-manager";

export const dynamic = "force-dynamic";

// =============================================================================
// Onglet « Parrainage » du hub Marketing — programme « Invite un ami »
// (mig 0403/0404). Toutes les lectures passent par des RPC gardées
// `admin_can('marketing')` avec la SESSION admin (le JWT porte l'email RBAC).
// =============================================================================
export default async function MarketingReferralTab() {
  await requireAdminDomain("marketing");
  const supabase = await createClient();

  // RPC hors types générés → bind OBLIGATOIRE (reference_supabase_rpc_bind).
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const from = supabase.from.bind(supabase) as unknown as (t: string) => {
    select: (c: string) => {
      eq: (
        col: string,
        v: number
      ) => {
        maybeSingle: () => Promise<{ data: AdminReferralSettings | null }>;
      };
    };
  };

  const [statsRes, listRes, settingsRes] = await Promise.all([
    rpc("admin_referral_stats", {}),
    rpc("admin_referral_list", { p_limit: 200 }),
    from("referral_settings")
      .select(
        "enabled, reward_referrer_da, reward_referee_da, min_order_da, max_referrals_month, attribution_expiry_days"
      )
      .eq("id", 1)
      .maybeSingle(),
  ]);

  const stats = (statsRes.data ?? null) as AdminReferralStats | null;
  const rows = (listRes.data ?? []) as AdminReferralRow[];
  const settings = settingsRes.data;

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <header className="mb-5">
        <h1 className="text-foreground text-xl font-extrabold">
          Parrainage client
        </h1>
        <p className="text-muted mt-1 text-sm">
          « Invite un ami » : récompense double créditée sur Coligo Pay à la 1ʳᵉ
          commande du filleul. Les cas suspects (même appareil, plafond) sont
          retenus ici pour revue. Kill-switch global : Plateforme → Contrôle.
        </p>
      </header>

      <ReferralManager stats={stats} rows={rows} settings={settings ?? null} />
    </div>
  );
}
