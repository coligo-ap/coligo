import { createClient } from "@/lib/supabase/server";
import { FraudAccountsView } from "@/components/admin/fraud/fraud-accounts-view";
import type { FraudScoreRow } from "@/lib/fraud/model";

export const dynamic = "force-dynamic";

/**
 * Centre Anti-Fraude — COMPTES À RISQUE : classement par risk score des 4
 * populations, recherche, accès à l'investigation détaillée.
 */
export default async function AdminFraudComptesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_fraud_ranking" as never,
    { p_kind: null, p_q: null, p_limit: 300 } as never
  );
  if (error) console.error("admin_fraud_ranking:", error.message);
  return (
    <FraudAccountsView
      initial={((data ?? []) as unknown as FraudScoreRow[]) ?? []}
    />
  );
}
