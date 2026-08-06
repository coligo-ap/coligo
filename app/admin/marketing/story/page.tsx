import { createAdminClient } from "@/lib/supabase/admin";
import { getShareStorySettings } from "@/lib/data/share-story";
import { ShareStoryManager } from "@/components/admin/marketing/share-story-manager";

export const dynamic = "force-dynamic";

// Onglet « Story » du hub Marketing : le PARTAGE STORY post-commande (mig
// 0440) — activation + design. Les conditions (cadeaux) viennent du
// parrainage et se règlent dans l'onglet Parrainage (source unique).
export default async function MarketingStoryTab() {
  const admin = createAdminClient();
  const [settings, { data: ref }] = await Promise.all([
    getShareStorySettings(),
    (
      admin.from as unknown as (t: string) => {
        select: (c: string) => {
          maybeSingle: () => Promise<{
            data: {
              enabled: boolean;
              reward_referrer_da: number;
              reward_referee_da: number;
              min_order_da: number;
            } | null;
          }>;
        };
      }
    )("referral_settings")
      .select("enabled, reward_referrer_da, reward_referee_da, min_order_da")
      .maybeSingle(),
  ]);

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-6">
      <p className="text-muted mb-4 text-sm">
        Le mégaphone viral : après chaque commande livrée, le client partage une
        story à son code parrain — chaque commande devient une pub.
      </p>
      <ShareStoryManager initial={settings} referral={ref} />
    </div>
  );
}
