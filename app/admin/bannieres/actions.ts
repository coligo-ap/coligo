"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isSuperAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// =============================================================================
// /admin/bannieres — bannières éditoriales (table promo_banners, mig 0026).
// Affichées sur l'accueil client (carrousel). Écritures gardées par
// isSuperAdmin() + tracées dans admin_audit_log. Service_role → bypass RLS.
// L'image est OPTIONNELLE (dégradé selon l'accent sinon) → champ URL, pas
// d'upload (zéro dépendance storage).
// =============================================================================

export type BannerActionState = { error?: string; ok?: boolean };

export type BannerInput = {
  title: string;
  subtitle: string;
  cta_label: string;
  image_url: string;
  link: string;
  accent: "violet" | "coral" | "mint" | "amber" | "dark";
  position: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

// promo_banners n'est pas dans database.types.ts généré → accès casté (cf. zones).
type DbErr = { message: string } | null;
type Resp = Promise<{ data: unknown; error: DbErr }>;
type BannerBuilder = {
  insert: (v: Record<string, unknown>) => {
    select: (c: string) => {
      single: () => Promise<{ data: { id?: string } | null; error: DbErr }>;
    };
  };
  update: (v: Record<string, unknown>) => {
    eq: (c: string, val: unknown) => Resp;
  };
  delete: () => { eq: (c: string, val: unknown) => Resp };
};
function bannerTable(
  admin: ReturnType<typeof createAdminClient>
): BannerBuilder {
  return (admin.from as unknown as (n: string) => BannerBuilder)(
    "promo_banners"
  );
}

async function adminEmail(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}

async function audit(action: string, bannerId: string | null, note?: string) {
  try {
    const admin = createAdminClient();
    await admin.from("admin_audit_log").insert({
      admin_email: await adminEmail(),
      action,
      target_kind: "banner",
      target_id: bannerId,
      note: note ?? null,
    });
  } catch {
    /* l'audit ne doit jamais faire échouer l'action */
  }
}

const bannerSchema = z.object({
  title: z.string().trim().min(1, "Le titre est requis.").max(100),
  subtitle: z.string().trim().max(200),
  cta_label: z.string().trim().max(50),
  // Le lien peut être interne (/favoris) ou externe (https://…) → texte libre.
  image_url: z.string().trim().max(500),
  link: z.string().trim().max(500),
  accent: z.enum(["violet", "coral", "mint", "amber", "dark"]),
  position: z.coerce.number().int().min(0).max(9999),
  active: z.boolean(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
});

function toRow(v: z.infer<typeof bannerSchema>) {
  return {
    title: v.title,
    subtitle: v.subtitle || null,
    cta_label: v.cta_label || null,
    image_url: v.image_url || null,
    link: v.link || null,
    accent: v.accent,
    position: v.position,
    active: v.active,
    starts_at: v.starts_at || null,
    ends_at: v.ends_at || null,
  };
}

function refresh() {
  revalidatePath("/admin/bannieres");
  revalidatePath("/"); // accueil client
}

export async function createBanner(
  input: BannerInput
): Promise<BannerActionState> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const parsed = bannerSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  try {
    const admin = createAdminClient();
    const { data, error } = await bannerTable(admin)
      .insert(toRow(parsed.data))
      .select("id")
      .single();
    if (error) return { error: `Échec : ${error.message}` };
    await audit("banner_create", data?.id ?? null, parsed.data.title);
    refresh();
    return { ok: true };
  } catch (e) {
    console.error("[createBanner] failed:", e);
    return { error: "Création impossible pour le moment." };
  }
}

export async function updateBanner(
  id: string,
  input: BannerInput
): Promise<BannerActionState> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const parsed = bannerSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  try {
    const admin = createAdminClient();
    const { error } = await bannerTable(admin)
      .update({ ...toRow(parsed.data), updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { error: `Échec : ${error.message}` };
    await audit("banner_update", id, parsed.data.title);
    refresh();
    return { ok: true };
  } catch (e) {
    console.error("[updateBanner] failed:", e);
    return { error: "Modification impossible pour le moment." };
  }
}

export async function toggleBanner(
  id: string,
  active: boolean
): Promise<BannerActionState> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  try {
    const admin = createAdminClient();
    const { error } = await bannerTable(admin)
      .update({ active, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { error: error.message };
    await audit(active ? "banner_enable" : "banner_disable", id);
    refresh();
    return { ok: true };
  } catch (e) {
    console.error("[toggleBanner] failed:", e);
    return { error: "Action impossible pour le moment." };
  }
}

export async function deleteBanner(id: string): Promise<BannerActionState> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  try {
    const admin = createAdminClient();
    const { error } = await bannerTable(admin).delete().eq("id", id);
    if (error) return { error: `Échec : ${error.message}` };
    await audit("banner_delete", id);
    refresh();
    return { ok: true };
  } catch (e) {
    console.error("[deleteBanner] failed:", e);
    return { error: "Suppression impossible pour le moment." };
  }
}
