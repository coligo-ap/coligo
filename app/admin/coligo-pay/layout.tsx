import { Wallet } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { FinancesHubTabs } from "@/components/admin/coligo-pay/finances-hub-tabs";

export const dynamic = "force-dynamic";

// Hub Coligo Pay & Finances : regroupe Surveillance / Agents / Inscriptions /
// Recharges / Versements en onglets. Bande d'onglets fine : chaque page garde
// son propre conteneur/titre. La fiche agent [id] est hors hub (autre arbre de
// routes). Le badge « Inscriptions » = demandes d'agent en attente. Gate
// super-admin assuré par app/admin/layout.tsx.
export default async function FinancesHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = createAdminClient();
  const { count } = await (
    admin.from as unknown as (t: string) => {
      select: (
        c: string,
        o: { count: "exact"; head: true }
      ) => {
        eq: (
          c: string,
          v: string
        ) => {
          eq: (c: string, v: string) => Promise<{ count: number | null }>;
        };
      };
    }
  )("operator_wallets")
    .select("id", { count: "exact", head: true })
    .eq("owner_type", "partner")
    .eq("status", "pending");
  const pendingCount = count ?? 0;

  return (
    <div>
      <div className="border-border border-b bg-white">
        <div className="mx-auto max-w-[1100px] px-4 pt-4 lg:px-6">
          <div className="mb-3 flex items-center gap-2">
            <Wallet className="size-5" />
            <h1 className="text-lg font-bold tracking-tight">
              Coligo Pay &amp; Finances
            </h1>
          </div>
          <div className="pb-2">
            <FinancesHubTabs pendingCount={pendingCount} />
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
