import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";

// =============================================================================
// Visuels commerçants (Commerçants > Visuels) — banque d'images HD (mig 0348)
// + état logo/couverture de chaque commerçant. Lectures service_role (la table
// merchant_image_bank n'a AUCUNE policy) → self-guard isSuperAdmin obligatoire.
// =============================================================================

export type BankImage = {
  id: string;
  kind: "cover" | "logo";
  category: string | null;
  label: string;
  url: string;
  position: number;
  active: boolean;
};

export type MerchantVisualRow = {
  id: string;
  name: string;
  category: string | null;
  logo_url: string | null;
  cover_url: string | null;
  commune: string | null;
};

/** Banque d'images ACTIVE, ordonnée par catégorie puis position. */
export async function getImageBank(): Promise<BankImage[]> {
  if (!(await isSuperAdmin())) return [];
  const admin = createAdminClient();
  const { data } = await (
    admin.from as unknown as (t: string) => {
      select: (c: string) => {
        eq: (
          c: string,
          v: boolean
        ) => {
          order: (
            c: string,
            o: { ascending: boolean }
          ) => Promise<{ data: BankImage[] | null }>;
        };
      };
    }
  )("merchant_image_bank")
    .select("id, kind, category, label, url, position, active")
    .eq("active", true)
    .order("position", { ascending: true });
  return data ?? [];
}

/** Tous les commerçants avec leur état visuel (logo / couverture). */
export async function getMerchantVisuals(): Promise<MerchantVisualRow[]> {
  if (!(await isSuperAdmin())) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("merchants")
    .select("id, name, category, logo_url, cover_url, commune")
    .order("name", { ascending: true });
  return (data ?? []) as MerchantVisualRow[];
}
