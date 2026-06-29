import { createAdminClient } from "@/lib/supabase/admin";

// Livreurs en attente de validation = livreurs (non bloqués) ayant au moins un
// document avec status='pending' (mig 0112) à examiner. La revue des pièces +
// la vérification se font sur la fiche /admin/drivers/[id].
export type DriverRegistration = {
  id: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  is_verified: boolean | null;
  created_at: string;
  pendingDocs: number;
};

export async function getDriverRegistrations(): Promise<DriverRegistration[]> {
  const admin = createAdminClient();

  const { data: docs } = await admin
    .from("driver_documents")
    .select("driver_id, status")
    .eq("status", "pending");

  const counts = new Map<string, number>();
  for (const d of docs ?? []) {
    counts.set(d.driver_id, (counts.get(d.driver_id) ?? 0) + 1);
  }
  const ids = [...counts.keys()];
  if (ids.length === 0) return [];

  const { data: drivers } = await admin
    .from("drivers")
    .select(
      "id, full_name, phone, avatar_url, is_verified, is_blocked, created_at"
    )
    .in("id", ids);

  return (drivers ?? [])
    .filter((d) => !d.is_blocked)
    .map((d) => ({
      id: d.id,
      full_name: d.full_name,
      phone: d.phone,
      avatar_url: d.avatar_url,
      is_verified: d.is_verified,
      created_at: d.created_at,
      pendingDocs: counts.get(d.id) ?? 0,
    }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
