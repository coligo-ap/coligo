import { createClient } from "@/lib/supabase/server";
import { FraudOverviewView } from "@/components/admin/fraud/fraud-overview-view";
import type { FraudOverview } from "@/lib/fraud/model";

export const dynamic = "force-dynamic";

/**
 * Centre Anti-Fraude — VUE D'ENSEMBLE (docs/ANTI-FRAUDE.md §8).
 * KPIs temps réel + alertes/actions 14 j + répartition des risques + comptes
 * les plus à risque + apprentissage des règles. Données via la RPC
 * `admin_fraud_overview` (SECURITY DEFINER, gardée admin_can('confiance')).
 */
export default async function AdminAntiFraudePage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_fraud_overview" as never);
  if (error) console.error("admin_fraud_overview:", error.message);
  return (
    <FraudOverviewView overview={(data ?? null) as FraudOverview | null} />
  );
}
