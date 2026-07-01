import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";

// Annuaire des Agents Coligo Pay (operator_wallets owner_type=partner) — partagé
// par l'annuaire, la sous-page Inscriptions et la route transverse /admin/agents.
export type AgentRow = {
  id: string;
  display_name: string | null;
  owner_name: string | null;
  phone: string | null;
  status: string;
  is_verified: boolean | null;
  wilaya: string | null;
  commune: string | null;
  submitted_at: string | null;
  created_at: string;
};

export async function loadAgents(): Promise<AgentRow[]> {
  // Self-guard : lecture service_role (bypass RLS) → non-admin ⇒ [] (mémoïsé).
  if (!(await isSuperAdmin())) return [];
  const admin = createAdminClient();
  const { data } = await (
    admin.from as unknown as (t: string) => {
      select: (c: string) => {
        eq: (
          c: string,
          v: string
        ) => {
          order: (
            c: string,
            o: { ascending: boolean }
          ) => Promise<{ data: AgentRow[] | null }>;
        };
      };
    }
  )("operator_wallets")
    .select(
      "id, display_name, owner_name, phone, status, is_verified, wilaya, commune, submitted_at, created_at"
    )
    .eq("owner_type", "partner")
    .order("created_at", { ascending: false });
  return data ?? [];
}
