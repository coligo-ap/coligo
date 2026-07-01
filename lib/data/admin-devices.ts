import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";

export type DeviceRow = {
  user_id: string;
  email: string;
  role: string;
  ip: string;
  ua: string;
  platform: string | null;
  is_standalone: boolean | null;
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  first_seen_at: string;
  last_seen_at: string;
  hits: number;
};

export type SharedIp = {
  ip: string;
  user_count: number;
  emails: string[];
  roles: string[];
  city: string | null;
  country: string | null;
  last_seen_at: string;
};

export type DevicesData = {
  rows: DeviceRow[];
  shared: SharedIp[];
  blocked: string[];
};

/**
 * Données de la page Appareils & connexions, partagées par la page (initialData)
 * et l'endpoint /api/admin/devices (cache TanStack Query). On récupère TOUS les
 * appareils (sans filtre serveur) → la recherche se fait CÔTÉ CLIENT (instantanée).
 * RPC/table hors types générés → bind + cast (cf. reference_supabase_rpc_bind).
 */
export async function getDevicesData(): Promise<DevicesData> {
  // Self-guard au point de convergence : cette lecture service_role (traçage IP,
  // anti-fraude, PII) alimente la page ET l'endpoint /api/admin/devices. Garder
  // ici protège TOUS les appelants même si l'un oublie son propre gate. Non-admin
  // ⇒ vide, sans throw (compatible route API). Mémoïsé par requête → coût nul.
  if (!(await isSuperAdmin())) return { rows: [], shared: [], blocked: [] };
  const admin = createAdminClient();
  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown }>;
  const fromB = admin.from.bind(admin) as unknown as (t: string) => {
    select: (c: string) => Promise<{ data: { ip: string }[] | null }>;
  };

  const [{ data: rowsRaw }, { data: sharedRaw }, { data: blkRaw }] =
    await Promise.all([
      rpc("admin_device_rows", { p_q: null, p_limit: 500 }),
      rpc("admin_shared_ips", { p_limit: 50 }),
      fromB("blocked_ips").select("ip"),
    ]);

  return {
    rows: (rowsRaw ?? []) as DeviceRow[],
    shared: (sharedRaw ?? []) as SharedIp[],
    blocked: (blkRaw ?? []).map((r) => r.ip),
  };
}
