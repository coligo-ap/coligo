import { requireAdminDomain } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  WheelManager,
  type AdminWheelPrize,
  type AdminWheelSettings,
  type AdminWheelStats,
} from "@/components/admin/wheel-manager";

export const dynamic = "force-dynamic";

// =============================================================================
// Onglet « Roue Coligo » du hub Marketing (mig 0407) : réglages, lots et coût.
// Self-guard : requireAdminDomain AVANT toute lecture service_role.
// =============================================================================
export default async function MarketingWheelTab() {
  await requireAdminDomain("marketing");

  const supabase = await createClient();
  const admin = createAdminClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string
  ) => Promise<{ data: AdminWheelStats | null }>;
  const from = admin.from.bind(admin) as unknown as (t: string) => {
    select: (c: string) => {
      order: (
        col: string,
        o: { ascending: boolean }
      ) => Promise<{ data: AdminWheelPrize[] | null }>;
      eq: (
        col: string,
        v: number
      ) => { maybeSingle: () => Promise<{ data: AdminWheelSettings | null }> };
    };
  };

  const [{ data: stats }, { data: prizes }, { data: settings }] =
    await Promise.all([
      rpc("admin_wheel_stats"),
      from("wheel_prizes")
        .select(
          "id, kind, amount_da, weight, label_fr, label_ar, active, position"
        )
        .order("position", { ascending: true }),
      from("wheel_settings")
        .select("enabled, streak_target, streak_multiplier")
        .eq("id", 1)
        .maybeSingle(),
    ]);

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-6">
      <header className="mb-5">
        <h1 className="text-foreground text-xl font-extrabold">Roue Coligo</h1>
        <p className="text-muted mt-1 text-sm">
          Jeu quotidien : un tour par client et par jour, tirage pondéré côté
          serveur. Un lot gagné crée un bon d&apos;achat crédité sur Coligo Pay
          (comptabilité SUM=0 automatique). Kill-switch : Plateforme → Contrôle
          (drapeau wheel).
        </p>
      </header>

      <WheelManager
        stats={stats}
        prizes={prizes ?? []}
        settings={settings ?? null}
      />
    </div>
  );
}
