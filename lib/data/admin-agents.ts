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

// operator_wallets hors types générés → builder minimal chaînable + awaitable.
type AgentsQuery = {
  select: (c: string, o?: { count: "exact" }) => AgentsQuery;
  eq: (c: string, v: string) => AgentsQuery;
  not: (c: string, op: string, v: string) => AgentsQuery;
  in: (c: string, v: string[]) => AgentsQuery;
  or: (f: string) => AgentsQuery;
  order: (c: string, o: { ascending: boolean }) => AgentsQuery;
  range: (a: number, b: number) => AgentsQuery;
} & PromiseLike<{ data: AgentRow[] | null; count: number | null }>;

/**
 * Annuaire des agents ACTIFS (hors demandes pending/rejected), PAGINÉ et
 * cherchable EN BASE — partagé par la vue (échantillon initial de 3) et
 * l'endpoint /api/admin/agents (recherche + « Voir plus »). On ne rapatrie
 * plus tout l'annuaire pour le filtrer dans le navigateur : la recherche
 * fait le travail (cf. règle annuaires admin).
 */
export async function searchAgents(opts?: {
  q?: string | null;
  limit?: number;
  offset?: number;
}): Promise<{ rows: AgentRow[]; total: number }> {
  // Self-guard : lecture service_role (bypass RLS) → non-admin ⇒ vide (mémoïsé).
  if (!(await isSuperAdmin())) return { rows: [], total: 0 };
  const admin = createAdminClient();
  const from = admin.from.bind(admin) as unknown as (t: string) => AgentsQuery;
  const limit = Math.min(Math.max(1, Math.floor(opts?.limit ?? 3)), 100);
  const offset = Math.max(0, Math.floor(opts?.offset ?? 0));
  // Motif nettoyé : virgules/parenthèses casseraient la syntaxe du .or()
  // PostgREST, % et _ sont des jokers LIKE — un terme libre reste inoffensif.
  const q = (opts?.q ?? "")
    .trim()
    .replace(/[%_,()]/g, " ")
    .trim();
  let query = from("operator_wallets")
    .select(
      "id, display_name, owner_name, phone, status, is_verified, wilaya, commune, submitted_at, created_at",
      { count: "exact" }
    )
    .eq("owner_type", "partner")
    .not("status", "in", "(pending,rejected)");
  if (q) {
    query = query.or(
      `display_name.ilike.%${q}%,owner_name.ilike.%${q}%,phone.ilike.%${q}%,wilaya.ilike.%${q}%,commune.ilike.%${q}%`
    );
  }
  const { data, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  const rows = data ?? [];
  return { rows, total: count ?? rows.length };
}

/**
 * Demandes de partenariat (pending + rejected) pour l'onglet Inscriptions —
 * requête SCOPÉE : on ne charge plus tout l'annuaire pour filtrer deux
 * statuts dans le navigateur. La file est petite par nature (elle se vide).
 */
export async function loadAgentRegistrations(): Promise<AgentRow[]> {
  if (!(await isSuperAdmin())) return [];
  const admin = createAdminClient();
  const from = admin.from.bind(admin) as unknown as (t: string) => AgentsQuery;
  const { data } = await from("operator_wallets")
    .select(
      "id, display_name, owner_name, phone, status, is_verified, wilaya, commune, submitted_at, created_at"
    )
    .eq("owner_type", "partner")
    .in("status", ["pending", "rejected"])
    .order("created_at", { ascending: false })
    .range(0, 199);
  return data ?? [];
}
