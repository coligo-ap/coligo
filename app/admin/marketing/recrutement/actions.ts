"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { adminCan } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateUploadedFile, MB } from "@/lib/security/file-validation";
import {
  RECRUTE_DESIGNS,
  DEFAULT_RECRUTE_ROLES,
} from "@/lib/config/recrute-content";

// =============================================================================
// /admin/marketing/recrutement — contenu et habillage de la page publique
// /recrute (tables recrute_page + recrute_roles, mig 0450).
//
// Écriture par service_role : les deux tables sont en lecture publique et
// n'ont AUCUNE policy d'écriture. Le garde est donc ici, en tête de chaque
// action — `adminCan("marketing")`, comme le reste du domaine.
//
// Après écriture : `revalidateTag("recrute-content")` (le cache de lecture) ET
// `revalidatePath("/recrute")` — sans les deux, la page servirait l'ancien
// contenu jusqu'à l'expiration des 5 minutes.
// =============================================================================

export type RecruteActionState = { error?: string; ok?: boolean };

type DbErr = { message: string } | null;

/** Tables absentes de database.types.ts généré → accès casté (convention projet). */
const table = (admin: ReturnType<typeof createAdminClient>, name: string) =>
  (
    admin.from as unknown as (t: string) => {
      update: (v: Record<string, unknown>) => {
        eq: (c: string, v: string | boolean) => Promise<{ error: DbErr }>;
      };
    }
  )(name);

const ROLE_KEYS = DEFAULT_RECRUTE_ROLES.map((r) => r.key) as [
  string,
  ...string[],
];

/**
 * Une chaîne vide veut dire « revenir au texte livré avec le code » : on écrit
 * NULL, jamais une chaîne vide (qui afficherait un blanc sur la page).
 */
const editable = z
  .string()
  .max(300)
  .transform((v) => v.trim())
  .transform((v) => (v.length ? v : null))
  .nullable();

const roleSchema = z.object({
  key: z.enum(ROLE_KEYS),
  imgUrl: z.string().max(600).nullable(),
  imgAlt: editable,
  title: editable,
  tagline: editable,
  highlight: editable,
  cta: editable,
  perks: z.array(z.string().max(200)).max(6),
});

const pageSchema = z.object({
  design: z.enum(
    Object.keys(RECRUTE_DESIGNS) as [string, ...string[]] // allowlist serveur
  ),
  heroTitle: editable,
  heroSubtitle: z.string().max(500).nullable(),
});

/** Best-effort : une trace d'audit ne doit jamais faire échouer l'action. */
async function audit(action: string, note: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await (
      supabase.from as unknown as (t: string) => {
        insert: (v: Record<string, unknown>) => Promise<unknown>;
      }
    )("admin_audit_log").insert({
      action,
      target_kind: "recrute_page",
      note,
      actor_email: user?.email ?? null,
    });
  } catch {
    /* silencieux */
  }
}

function refresh() {
  revalidateTag("recrute-content");
  revalidatePath("/recrute");
  revalidatePath("/admin/marketing/recrutement");
}

/** Habillage du héros + titres de la page. */
export async function setRecrutePage(
  input: z.infer<typeof pageSchema>
): Promise<RecruteActionState> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  const parsed = pageSchema.safeParse(input);
  if (!parsed.success) return { error: "Réglage invalide." };

  try {
    const admin = createAdminClient();
    const { error } = await table(admin, "recrute_page")
      .update({
        design: parsed.data.design,
        hero_title: parsed.data.heroTitle,
        hero_subtitle: parsed.data.heroSubtitle?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
    if (error) return { error: `Échec : ${error.message}` };

    await audit("set_recrute_page", `habillage : ${parsed.data.design}`);
    refresh();
    return { ok: true };
  } catch (e) {
    console.error("[setRecrutePage] failed:", e);
    return { error: "Enregistrement impossible pour le moment." };
  }
}

/** Contenu d'UNE carte métier. */
export async function setRecruteRole(
  input: z.infer<typeof roleSchema>
): Promise<RecruteActionState> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return { error: "Contenu invalide." };

  // Une image ne peut venir QUE de notre stockage : une URL externe serait
  // affichée telle quelle sur une page publique (et casserait hors ligne).
  const storagePrefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`;
  const img = parsed.data.imgUrl?.trim() || null;
  if (img && !img.startsWith(storagePrefix) && !img.startsWith("/heros/")) {
    return { error: "Photo invalide — utilise le bouton d'import." };
  }

  const perks = parsed.data.perks.map((p) => p.trim()).filter(Boolean);

  try {
    const admin = createAdminClient();
    const { error } = await table(admin, "recrute_roles")
      .update({
        img_url: img,
        img_alt: parsed.data.imgAlt,
        title: parsed.data.title,
        tagline: parsed.data.tagline,
        highlight: parsed.data.highlight,
        cta: parsed.data.cta,
        perks: perks.length ? perks : null,
        updated_at: new Date().toISOString(),
      })
      .eq("key", parsed.data.key);
    if (error) return { error: `Échec : ${error.message}` };

    await audit("set_recrute_role", parsed.data.key);
    refresh();
    return { ok: true };
  } catch (e) {
    console.error("[setRecruteRole] failed:", e);
    return { error: "Enregistrement impossible pour le moment." };
  }
}

/** Import d'une photo de carte (bucket public `promo-banners`, comme les bannières). */
export async function uploadRecruteImage(
  formData: FormData
): Promise<{ url?: string; error?: string }> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  // Validation par MAGIC BYTES : le type annoncé par le navigateur n'est
  // jamais cru (un SVG déguisé serait un vecteur d'injection).
  const v = await validateUploadedFile(formData.get("file"), {
    kind: "image",
    maxBytes: 5 * MB,
  });
  if (!v.ok) return { error: v.error };

  try {
    const admin = createAdminClient();
    const path = `recrute-${Date.now()}-${globalThis.crypto
      .randomUUID()
      .slice(0, 8)}.${v.ext}`;
    const { error } = await admin.storage
      .from("promo-banners")
      .upload(path, v.bytes, { contentType: v.mime, upsert: false });
    if (error) return { error: `Import échoué : ${error.message}` };
    const { data } = admin.storage.from("promo-banners").getPublicUrl(path);
    return { url: data.publicUrl };
  } catch (e) {
    console.error("[uploadRecruteImage] failed:", e);
    return { error: "Import impossible pour le moment." };
  }
}
