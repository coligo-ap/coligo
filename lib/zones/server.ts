import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  ZONE_OK,
  type ServiceKind,
  type ZoneEval,
  type ZoneRole,
} from "./service-zones";

/**
 * Évalue la couverture d'un POINT pour un service (wrapper serveur du RPC
 * `evaluate_service_zone`, mig 0169). FAIL-OPEN sur erreur infra : le verdict
 * réel reste garanti par le trigger orders / le RPC request_ride (bypass-proof),
 * donc un échec réseau ici ne bloque pas à tort — au pire la DB tranchera.
 */
export async function evaluateZone(
  service: ServiceKind,
  lat: number | null | undefined,
  lng: number | null | undefined,
  opts?: {
    wilayaCode?: string | null;
    commune?: string | null;
    role?: ZoneRole;
  }
): Promise<ZoneEval> {
  try {
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc("evaluate_service_zone", {
      p_service: service,
      p_lat: lat ?? null,
      p_lng: lng ?? null,
      p_wilaya_code: opts?.wilayaCode ?? null,
      p_commune: opts?.commune ?? null,
      p_role: opts?.role ?? "any",
    });
    if (error || !data) return ZONE_OK;
    const row = (Array.isArray(data) ? data[0] : data) as
      | {
          allowed?: boolean;
          reason?: string;
          label?: string | null;
          coming_soon?: boolean;
        }
      | undefined;
    if (!row) return ZONE_OK;
    return {
      allowed: row.allowed !== false,
      reason: row.reason ?? "ok",
      label: row.label ?? null,
      coming_soon: !!row.coming_soon,
    };
  } catch {
    return ZONE_OK;
  }
}

/**
 * Journalise un refus RÉEL (commande/course bloquée hors zone) pour les stats
 * ops (mig 0170). Best-effort : ne jamais faire échouer le flux appelant. À
 * n'appeler QU'aux soumissions réellement bloquées (pas les prechecks UX).
 */
export async function logZoneBlock(input: {
  service: ServiceKind;
  source: "order" | "drive";
  role?: ZoneRole | null;
  reason?: string | null;
  lat?: number | null;
  lng?: number | null;
  wilayaCode?: string | null;
  commune?: string | null;
}): Promise<void> {
  try {
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ error: { message: string } | null }>;
    await rpc("log_zone_block", {
      p_service: input.service,
      p_source: input.source,
      p_role: input.role ?? null,
      p_reason: input.reason ?? null,
      p_lat: input.lat ?? null,
      p_lng: input.lng ?? null,
      p_wilaya_code: input.wilayaCode ?? null,
      p_commune: input.commune ?? null,
    });
  } catch {
    /* best-effort : la journalisation ne bloque jamais */
  }
}
