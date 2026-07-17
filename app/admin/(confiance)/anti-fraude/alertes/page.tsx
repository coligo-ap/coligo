import { createClient } from "@/lib/supabase/server";
import { FraudAlertsView } from "@/components/admin/fraud/fraud-alerts-view";
import type { FraudAlertRow } from "@/lib/fraud/model";

export const dynamic = "force-dynamic";

/**
 * Centre Anti-Fraude — ALERTES. L'examen (Confirmer / Faux positif) est le
 * LABEL D'APPRENTISSAGE du moteur : chaque verdict ajuste le poids futur de la
 * règle (docs/ANTI-FRAUDE.md §3-4).
 */
export default async function AdminFraudAlertesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_fraud_alerts" as never,
    { p_status: null, p_severity: null, p_kind: null, p_limit: 300 } as never
  );
  if (error) console.error("admin_fraud_alerts:", error.message);
  return (
    <FraudAlertsView
      initial={((data ?? []) as unknown as FraudAlertRow[]) ?? []}
    />
  );
}
