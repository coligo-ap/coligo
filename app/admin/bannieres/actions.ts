"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminCan } from "@/lib/auth/admin";
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
  /** Opacité (0–100) de l'image en mode « Texture de fond ». */
  overlay_opacity: number;
  link: string;
  accent: "violet" | "coral" | "mint" | "amber" | "dark";
  position: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  /** Zones ciblées (vide = bannière GLOBALE, visible partout). Éditoriale only. */
  zones: BannerZone[];
  /**
   * OFFRE COMMERÇANT (mig 0330) — relie la bannière à une promotion RÉELLE.
   * `promotion_id` + `merchant_id` définis ⇒ bannière « offre » : le ciblage géo
   * suit le commerçant, le lien devient sa boutique, et l'offre live est
   * affichée en pop-up. Les deux NULL ⇒ bannière éditoriale classique.
   */
  promotion_id: string | null;
  merchant_id: string | null;
  /** Rayon de ciblage forcé (km) — null = auto (portée du commerçant). */
  geo_radius_km: number | null;
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
  overlay_opacity: z.coerce
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .default(30),
  link: z.string().trim().max(500),
  accent: z.enum(["violet", "coral", "mint", "amber", "dark"]),
  position: z.coerce.number().int().min(0).max(9999),
  active: z.boolean(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  promotion_id: z.string().uuid().nullable().optional().default(null),
  merchant_id: z.string().uuid().nullable().optional().default(null),
  geo_radius_km: z.coerce
    .number()
    .positive()
    .max(200)
    .nullable()
    .optional()
    .default(null),
});

/**
 * Valide le mode « offre commerçant » et renvoie merchant_id/promotion_id sûrs
 * (ou null,null pour une bannière éditoriale). Vérifie côté serveur que la promo
 * EXISTE et APPARTIENT bien au commerçant annoncé (source de vérité DB, pas la
 * confiance dans le formulaire). Renvoie une erreur explicite sinon.
 */
async function resolveOffer(
  admin: ReturnType<typeof createAdminClient>,
  input: BannerInput
): Promise<
  | { ok: true; merchant_id: string | null; promotion_id: string | null }
  | { ok: false; error: string }
> {
  const promotionId = input.promotion_id?.trim() || null;
  const merchantId = input.merchant_id?.trim() || null;
  // Éditoriale : aucun des deux → rien à valider.
  if (!promotionId && !merchantId) {
    return { ok: true, merchant_id: null, promotion_id: null };
  }
  if (!promotionId || !merchantId) {
    return {
      ok: false,
      error: "Sélectionne un commerçant ET une de ses offres.",
    };
  }
  const { data, error } = await admin
    .from("promotions")
    .select("id, merchant_id, status")
    .eq("id", promotionId)
    .maybeSingle();
  if (error)
    return { ok: false, error: `Vérification impossible : ${error.message}` };
  if (!data) return { ok: false, error: "Cette offre n'existe plus." };
  if (data.merchant_id !== merchantId) {
    return {
      ok: false,
      error: "Cette offre n'appartient pas à ce commerçant.",
    };
  }
  if (data.status === "disabled" || data.status === "expired") {
    return {
      ok: false,
      error:
        "Cette offre est désactivée ou expirée — choisis une offre active.",
    };
  }
  return { ok: true, merchant_id: merchantId, promotion_id: promotionId };
}

function toRow(
  v: z.infer<typeof bannerSchema>,
  offer: { merchant_id: string | null; promotion_id: string | null }
) {
  const isOffer = !!offer.merchant_id && !!offer.promotion_id;
  return {
    title: v.title,
    subtitle: v.subtitle || null,
    cta_label: v.cta_label || null,
    image_url: v.image_url || null,
    image_fit: v.image_fit,
    overlay_opacity: v.overlay_opacity ?? 30,
    // En mode offre, le clic ouvre la pop-up puis redirige vers la boutique :
    // le lien libre est ignoré (redirection dérivée du slug commerçant).
    link: isOffer ? null : v.link || null,
    accent: v.accent,
    position: v.position,
    active: v.active,
    starts_at: v.starts_at || null,
    ends_at: v.ends_at || null,
    promotion_id: offer.promotion_id,
    merchant_id: offer.merchant_id,
    // Rayon forcé seulement pertinent en mode offre.
    geo_radius_km: isOffer ? (v.geo_radius_km ?? null) : null,
  };
}

function refresh() {
  revalidatePath("/admin/bannieres");
  revalidatePath("/"); // accueil client
}

export async function createBanner(
  input: BannerInput
): Promise<BannerActionState> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  const parsed = bannerSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  try {
    const admin = createAdminClient();
    const offer = await resolveOffer(admin, input);
    if (!offer.ok) return { error: offer.error };
    const isOffer = !!offer.merchant_id;
    const { data, error } = await bannerTable(admin)
      .insert(toRow(parsed.data, offer))
      .select("id")
      .single();
    if (error) return { error: `Échec : ${error.message}` };
    // Le ciblage géo d'une offre suit le commerçant → pas de zones manuelles.
    if (data?.id)
      await replaceZones(admin, data.id, isOffer ? [] : (input.zones ?? []));
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
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  const parsed = bannerSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  try {
    const admin = createAdminClient();
    const offer = await resolveOffer(admin, input);
    if (!offer.ok) return { error: offer.error };
    const isOffer = !!offer.merchant_id;
    const { error } = await bannerTable(admin)
      .update({
        ...toRow(parsed.data, offer),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return { error: `Échec : ${error.message}` };
    await replaceZones(admin, id, isOffer ? [] : (input.zones ?? []));
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
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
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
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
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
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
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

// ===========================================================================
// Mode « offre commerçant » — sélection de la promo à mettre en avant.
// Lectures super-admin (service_role) gardées par adminCan('marketing'). On ne
// crée/modifie JAMAIS d'offre ici : la plateforme ne fait que POINTER vers une
// promotion déjà publiée par le commerçant (source de vérité = son espace).
// ===========================================================================

export type OfferMerchantOption = {
  id: string;
  name: string;
  slug: string;
  commune: string | null;
  wilaya_code: string | null;
  /** Nombre d'offres actuellement actives chez ce commerçant. */
  active_offers: number;
};

/** Recherche des commerçants ACTIFS (par nom), annotés du nombre d'offres actives. */
export async function searchOfferMerchants(
  q: string
): Promise<OfferMerchantOption[]> {
  if (!(await adminCan("marketing"))) return [];
  try {
    const admin = createAdminClient();
    let query = admin
      .from("merchants")
      .select("id, name, slug, commune, wilaya_code")
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(30);
    const term = q.trim();
    if (term) query = query.ilike("name", `%${term}%`);
    const { data: merchants } = await query;
    const list = (merchants ?? []) as {
      id: string;
      name: string;
      slug: string;
      commune: string | null;
      wilaya_code: string | null;
    }[];
    if (list.length === 0) return [];
    const ids = list.map((m) => m.id);
    const { data: promos } = await admin
      .from("promotions")
      .select("merchant_id")
      .eq("status", "active")
      .in("merchant_id", ids);
    const counts = new Map<string, number>();
    for (const p of (promos ?? []) as { merchant_id: string }[]) {
      counts.set(p.merchant_id, (counts.get(p.merchant_id) ?? 0) + 1);
    }
    return list
      .map((m) => ({ ...m, active_offers: counts.get(m.id) ?? 0 }))
      .sort(
        (a, b) =>
          b.active_offers - a.active_offers || a.name.localeCompare(b.name)
      );
  } catch (e) {
    console.error("[searchOfferMerchants] failed:", e);
    return [];
  }
}

export type OfferOption = {
  id: string;
  type:
    | "product_discount"
    | "promo_code"
    | "quantity_offer"
    | "free_gift"
    | "free_delivery";
  title_fr: string;
  discount_kind: "percent" | "amount" | null;
  discount_value: number | null;
  code: string | null;
  buy_qty: number | null;
  get_qty: number | null;
  gift_label: string | null;
  min_subtotal_da: number | null;
  ends_at: string | null;
};

/** Offres ACTIVES d'un commerçant, sélectionnables pour la bannière. */
export async function listMerchantOffers(
  merchantId: string
): Promise<OfferOption[]> {
  if (!(await adminCan("marketing"))) return [];
  if (!merchantId) return [];
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("promotions")
      .select(
        "id, type, title_fr, discount_kind, discount_value, code, buy_qty, get_qty, gift_label, min_subtotal_da, ends_at"
      )
      .eq("merchant_id", merchantId)
      .eq("status", "active")
      .order("created_at", { ascending: false });
    return ((data ?? []) as OfferOption[]).map((o) => ({
      ...o,
      discount_value:
        o.discount_value != null ? Number(o.discount_value) : null,
    }));
  } catch (e) {
    console.error("[listMerchantOffers] failed:", e);
    return [];
  }
}
