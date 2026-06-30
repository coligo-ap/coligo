import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AdminAlert } from "@/lib/alerts/alert-model";

export type { AdminAlert } from "@/lib/alerts/alert-model";

/**
 * Alertes super-admin (RPC SECURITY DEFINER `admin_alerts`, mig 0274). La RPC
 * est gardée `is_super_admin()` côté base : un non-admin reçoit une exception
 * (qu'on avale en `[]` ici — l'appelant est de toute façon déjà gaté par
 * `requireSuperAdmin()`). Lecture seule, aucune PII (compteurs + codes).
 *
 * Le NOM de la RPC n'est pas dans database.types.ts généré → cast `as never`,
 * mais on garde l'appel `supabase.rpc(...)` pour conserver le binding `this`
 * (cf. piège supabase_rpc_bind).
 */
export async function getAdminAlerts(): Promise<AdminAlert[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_alerts" as never);
  if (error) {
    console.error("admin_alerts:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as AdminAlert[]).map((a) => ({
    code: String(a.code),
    domain: a.domain,
    severity: a.severity,
    count: Number(a.count ?? 0),
    label: String(a.label ?? ""),
    href: String(a.href ?? "#"),
    since: a.since ?? null,
  }));
}
