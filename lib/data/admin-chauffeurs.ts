import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";
import type { ChauffeurRow } from "@/components/admin/chauffeurs/chauffeur-list";

/** Ligne d'annuaire chauffeur + submitted_at (sert au compteur d'inscriptions). */
export type AdminChauffeurRow = ChauffeurRow & { submitted_at: string | null };

/**
 * Annuaire chauffeurs pour l'admin, PAGINÉ et cherchable EN BASE — partagé par
 * la page (échantillon initial) et l'endpoint /api/admin/chauffeurs (recherche
 * + « Voir plus »). On ne rapatrie plus tout l'annuaire pour le filtrer dans
 * le navigateur : la recherche fait le travail.
 */
export async function getChauffeurRowsForAdmin(opts?: {
  q?: string | null;
  limit?: number;
  offset?: number;
}): Promise<{ rows: AdminChauffeurRow[]; total: number }> {
  // Self-guard : lecture service_role (bypass RLS) → non-admin ⇒ vide (mémoïsé).
  if (!(await isSuperAdmin())) return { rows: [], total: 0 };
  const admin = createAdminClient();
  const limit = Math.min(Math.max(1, Math.floor(opts?.limit ?? 3)), 100);
  const offset = Math.max(0, Math.floor(opts?.offset ?? 0));
  // Motif nettoyé : virgules/parenthèses casseraient la syntaxe du .or()
  // PostgREST, % et _ sont des jokers LIKE — un terme libre reste inoffensif.
  const q = (opts?.q ?? "")
    .trim()
    .replace(/[%_,()]/g, " ")
    .trim();
  let query = admin
    .from("chauffeurs")
    .select(
      "id, full_name, phone, gamme, vehicle_make, vehicle_model, vehicle_plate, is_verified, is_frozen, is_blocked, frozen_reason, submitted_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (q) {
    query = query.or(
      `full_name.ilike.%${q}%,phone.ilike.%${q}%,vehicle_plate.ilike.%${q}%,gamme.ilike.%${q}%`
    );
  }
  const { data, count } = await query;
  const rows = (data ?? []) as AdminChauffeurRow[];
  return { rows, total: count ?? rows.length };
}

/**
 * Dossiers d'inscription à valider (non vérifiés, non bloqués, dossier
 * TRANSMIS) — compteur dédié : le hub ne charge plus tout l'annuaire pour le
 * calculer. Même définition que le filtre historique de la page.
 */
export async function countPendingChauffeurs(): Promise<number> {
  if (!(await isSuperAdmin())) return 0;
  const admin = createAdminClient();
  // NULL compte comme « non » (générations d'avant les colonnes) — mêmes
  // règles que le filtre JS historique `!is_verified && !is_blocked`.
  const { count } = await admin
    .from("chauffeurs")
    .select("id", { count: "exact", head: true })
    .or("is_verified.is.null,is_verified.eq.false")
    .or("is_blocked.is.null,is_blocked.eq.false")
    .not("submitted_at", "is", null);
  return count ?? 0;
}
