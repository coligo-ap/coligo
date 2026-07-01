import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";
import type { ChauffeurRow } from "@/components/admin/chauffeurs/chauffeur-list";

/** Ligne d'annuaire chauffeur + submitted_at (sert au compteur d'inscriptions). */
export type AdminChauffeurRow = ChauffeurRow & { submitted_at: string | null };

/**
 * Annuaire chauffeurs pour l'admin, partagé par la page (initialData) et
 * l'endpoint /api/admin/chauffeurs (cache TanStack Query).
 */
export async function getChauffeurRowsForAdmin(): Promise<AdminChauffeurRow[]> {
  // Self-guard : lecture service_role (bypass RLS) → non-admin ⇒ [] (mémoïsé).
  if (!(await isSuperAdmin())) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("chauffeurs")
    .select(
      "id, full_name, phone, gamme, vehicle_make, vehicle_model, vehicle_plate, is_verified, is_frozen, is_blocked, frozen_reason, submitted_at"
    )
    .order("created_at", { ascending: false })
    .limit(2000);
  return (data ?? []) as AdminChauffeurRow[];
}
