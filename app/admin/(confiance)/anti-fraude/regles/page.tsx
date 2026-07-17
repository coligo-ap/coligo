import { createClient } from "@/lib/supabase/server";
import { FraudRulesView } from "@/components/admin/fraud/fraud-rules-view";
import type { FraudRuleRow, FraudSettingRow } from "@/lib/fraud/model";

export const dynamic = "force-dynamic";

/**
 * Centre Anti-Fraude — RÈGLES & RÉGLAGES : activation, poids, seuils (params),
 * précision apprise par règle, et seuils d'automatisation du moteur.
 */
export default async function AdminFraudReglesPage() {
  const supabase = await createClient();
  const [rulesRes, settingsRes] = await Promise.all([
    supabase.rpc("admin_fraud_rules" as never),
    supabase.rpc("admin_fraud_settings" as never),
  ]);
  if (rulesRes.error)
    console.error("admin_fraud_rules:", rulesRes.error.message);
  if (settingsRes.error)
    console.error("admin_fraud_settings:", settingsRes.error.message);
  return (
    <FraudRulesView
      rules={((rulesRes.data ?? []) as unknown as FraudRuleRow[]) ?? []}
      settings={
        ((settingsRes.data ?? []) as unknown as FraudSettingRow[]) ?? []
      }
    />
  );
}
