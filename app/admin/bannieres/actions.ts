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

/** Zone de ciblage (rayon géométrique). Plusieurs par bannière = plusieurs zones. */
export type BannerZone = {
  label: string;
  center_lat: number;
  center_lng: number;
  radius_km: number;
};

export type BannerInput = {
  title: string;
  subtitle: string;
  cta_label: string;
  image_url: string;
  /** Comment l'image s'intègre : pleine (recadrée) / entière / texture de fond. */
  image_fit: "cover" | "contain" | "overlay";
  link: string;
  accent: "violet" | "coral" | "mint" | "amber" | "dark";
  position: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  /** Zones ciblées (vide = bannière GLOBALE, visible partout). */
  zones: BannerZone[];
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

// Table des zones (hors types générés → accès casté). delete(eq) + insert(rows).
type ZonesBuilder = {
  delete: () => { eq: (c: string, v: unknown) => Resp };
  insert: (rows: Record<string, unknown>[]) => Resp;
};
function zonesTable(admin: ReturnType<typeof createAdminClient>): ZonesBuilder {
  return (admin.from as unknown as (n: string) => ZonesBuilder)(
    "promo_banner_zones"
  );
}

const zoneSchema = z.object({
  label: z.string().trim().max(80),
  center_lat: z.coerce.number().min(-90).max(90),
  center_lng: z.coerce.number().min(-180).max(180),
  radius_km: z.coerce.number().positive().max(200),
});

/** Remplace TOUTES les zones d'une bannière (delete + insert). */
async function replaceZones(
  admin: ReturnType<typeof createAdminClient>,
  bannerId: string,
  zones: BannerZone[]
): Promise<void> {
  await zonesTable(admin).delete().eq("banner_id", bannerId);
  const rows = zones
    .map((zz) => zoneSchema.safeParse(zz))
    .filter((r) => r.success)
    .map((r) => {
      const v = (r as { data: z.infer<typeof zoneSchema> }).data;
      return {
        banner_id: bannerId,
        scope: "radius",
        label: v.label || null,
        center_lat: v.center_lat,
        center_lng: v.center_lng,
        radius_km: v.radius_km,
      };
    });
  if (rows.length) await zonesTable(admin).insert(rows);
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
  image_fit: z.enum(["cover", "contain", "overlay"]),
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
    image_fit: v.image_fit,
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
    if (data?.id) await replaceZones(admin, data.id, input.zones ?? []);
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
    await replaceZones(admin, id, input.zones ?? []);
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

/**
 * Upload d'une image de bannière vers le bucket public `promo-banners` (mig 0248)
 * et renvoi de l'URL publique. Super-admin only. Validation type + taille — même
 * une grande image est acceptée (≤ 5 Mo), le rendu (object-fit) l'intègre au
 * cadre. Le client redimensionne déjà avant l'envoi pour alléger.
 */
export async function uploadBannerImage(
  formData: FormData
): Promise<{ url?: string; error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { error: "Aucune image sélectionnée." };
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    return { error: "Format accepté : PNG, JPG ou WEBP." };
  if (file.size > 5 * 1024 * 1024)
    return { error: "Image trop lourde (5 Mo maximum)." };

  try {
    const admin = createAdminClient();
    const ext =
      file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : "jpg";
    const path = `banner-${Date.now()}-${globalThis.crypto.randomUUID().slice(0, 8)}.${ext}`;
    const { error } = await admin.storage
      .from("promo-banners")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) return { error: `Upload échoué : ${error.message}` };
    const { data } = admin.storage.from("promo-banners").getPublicUrl(path);
    return { url: data.publicUrl };
  } catch (e) {
    console.error("[uploadBannerImage] failed:", e);
    return { error: "Upload impossible pour le moment." };
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
