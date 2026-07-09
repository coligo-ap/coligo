import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";
import type { DriverRow } from "@/components/admin/drivers/driver-list";

// File d'attente de validation = livreurs (non bloqués, non vérifiés) qui ont
// TRANSMIS leur dossier (`submitted_at`, mig 0352). Tant qu'un livreur remplit
// encore son formulaire, il n'apparaît pas ici : il n'y a rien à examiner.
// La revue des pièces + la décision se font sur la fiche /admin/drivers/[id].
export type DriverRegistration = {
  id: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  is_verified: boolean | null;
  created_at: string;
  submitted_at: string;
  pendingDocs: number;
};

export async function getDriverRegistrations(): Promise<DriverRegistration[]> {
  // Self-guard : lecture service_role (bypass RLS) → non-admin ⇒ [] (mémoïsé).
  if (!(await isSuperAdmin())) return [];
  const admin = createAdminClient();

  const { data: drivers } = await admin
    .from("drivers")
    .select(
      "id, full_name, phone, avatar_url, is_verified, created_at, submitted_at"
    )
    .eq("is_blocked", false)
    .eq("is_verified", false)
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: true });

  const ids = (drivers ?? []).map((d) => d.id);
  if (ids.length === 0) return [];

  const { data: docs } = await admin
    .from("driver_documents")
    .select("driver_id")
    .eq("status", "pending")
    .in("driver_id", ids);

  const counts = new Map<string, number>();
  for (const d of docs ?? []) {
    counts.set(d.driver_id, (counts.get(d.driver_id) ?? 0) + 1);
  }

  return (drivers ?? []).map((d) => ({
    id: d.id,
    full_name: d.full_name,
    phone: d.phone,
    avatar_url: d.avatar_url,
    is_verified: d.is_verified,
    created_at: d.created_at,
    submitted_at: d.submitted_at as string,
    pendingDocs: counts.get(d.id) ?? 0,
  }));
}

/**
 * Annuaire livreurs pour l'admin (lignes + stats réseau), partagé par la page
 * (initialData) et l'endpoint /api/admin/drivers (cache TanStack Query).
 */
export async function getDriverRowsForAdmin(): Promise<DriverRow[]> {
  // Self-guard : lecture service_role (bypass RLS) → non-admin ⇒ [] (mémoïsé).
  if (!(await isSuperAdmin())) return [];
  const admin = createAdminClient();
  const { data: drivers } = await admin
    .from("drivers")
    .select(
      "id, full_name, phone, is_frozen, is_blocked, is_verified, avatar_url, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(2000);

  const driverIds = (drivers ?? []).map((d) => d.id);
  const { data: links } = driverIds.length
    ? await admin
        .from("merchant_drivers")
        .select("driver_id, status")
        .in("driver_id", driverIds)
    : { data: [] };

  const stats = new Map<
    string,
    { active: number; pending: number; blocked: number }
  >();
  for (const l of links ?? []) {
    const cur = stats.get(l.driver_id) ?? { active: 0, pending: 0, blocked: 0 };
    cur[l.status as "active" | "pending" | "blocked"] += 1;
    stats.set(l.driver_id, cur);
  }

  return (drivers ?? []).map((d) => {
    const s = stats.get(d.id) ?? { active: 0, pending: 0, blocked: 0 };
    return {
      id: d.id,
      full_name: d.full_name,
      phone: d.phone,
      is_frozen: d.is_frozen,
      is_blocked: d.is_blocked,
      is_verified: d.is_verified,
      avatar_url: d.avatar_url,
      active: s.active,
      pending: s.pending,
      blocked: s.blocked,
    };
  });
}
