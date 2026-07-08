"use server";

import { revalidatePath } from "next/cache";
import { adminCan } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BankImage } from "@/lib/data/admin-visuals";

// =============================================================================
// Commerçants > Visuels — actions super-admin : relier une image de la banque
// (mig 0348) ou une URL à un commerçant (couverture / logo), attribution
// AUTOMATIQUE par catégorie, gestion de la banque. Gate admin_can('commercants')
// + audit admin_audit_log. Service_role → bypass RLS (aucune policy sur la
// banque : elle n'est lisible/éditable QUE d'ici).
// =============================================================================

export type VisualActionState = {
  error?: string;
  ok?: boolean;
  count?: number;
};

async function adminEmail(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}

async function audit(action: string, targetId: string | null, note?: string) {
  try {
    const admin = createAdminClient();
    await (
      admin.from as unknown as (t: string) => {
        insert: (v: Record<string, unknown>) => Promise<unknown>;
      }
    )("admin_audit_log").insert({
      admin_email: await adminEmail(),
      action,
      target_kind: "merchant_visual",
      target_id: targetId,
      note: note ?? null,
    });
  } catch {
    // L'audit ne bloque jamais l'action.
  }
}

/**
 * Valide qu'une URL désigne bien une IMAGE réelle : https obligatoire, puis
 * HEAD serveur (6 s max) → le Content-Type doit être image/*. Empêche de
 * relier une URL morte ou un contenu non-image à une vitrine publique.
 */
async function validateImageUrl(raw: string): Promise<string | null> {
  const url = raw.trim();
  if (!/^https:\/\//i.test(url) || url.length > 800) {
    return "URL invalide — elle doit commencer par https://";
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return `L'image ne répond pas (HTTP ${res.status}).`;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) {
      return "Cette URL ne pointe pas vers une image.";
    }
    return null;
  } catch {
    return "Image injoignable — vérifiez l'URL.";
  }
}

/** Table banque (hors types générés → accès casté, cf. pattern bannières). */
type DbErr = { message: string } | null;
function bankTable(admin: ReturnType<typeof createAdminClient>) {
  return (
    admin.from as unknown as (t: string) => {
      select: (c: string) => {
        eq: (
          c: string,
          v: boolean
        ) => {
          order: (
            c: string,
            o: { ascending: boolean }
          ) => Promise<{ data: BankImage[] | null; error: DbErr }>;
        };
      };
      insert: (v: Record<string, unknown>) => Promise<{ error: DbErr }>;
      update: (v: Record<string, unknown>) => {
        eq: (c: string, v2: string) => Promise<{ error: DbErr }>;
      };
    }
  )("merchant_image_bank");
}

/**
 * Définit (ou retire, url=null) la COUVERTURE ou le LOGO d'un commerçant.
 * L'URL est validée côté serveur (image réelle) avant écriture.
 */
export async function setMerchantVisual(
  merchantId: string,
  field: "cover" | "logo",
  url: string | null
): Promise<VisualActionState> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };
  if (!merchantId) return { error: "Commerçant manquant." };

  const clean = url?.trim() || null;
  if (clean) {
    const err = await validateImageUrl(clean);
    if (err) return { error: err };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("merchants")
    .update(field === "cover" ? { cover_url: clean } : { logo_url: clean })
    .eq("id", merchantId);
  if (error) return { error: error.message };

  await audit(
    clean ? `visual_set_${field}` : `visual_clear_${field}`,
    merchantId,
    clean ?? undefined
  );
  revalidatePath("/admin/merchants/visuels");
  return { ok: true };
}

/**
 * Choix INTELLIGENT d'un visuel de banque pour un commerçant : d'abord sa
 * catégorie exacte, sinon les visuels génériques (category null), sinon
 * « autre ». La rotation est stable par commerçant (hash de l'id) → deux
 * supérettes voisines ne reçoivent pas la même photo.
 */
function pickBankCover(
  bank: BankImage[],
  category: string | null,
  merchantId: string
): BankImage | null {
  const covers = bank.filter((b) => b.kind === "cover" && b.active);
  const pool =
    covers.filter((b) => b.category === category && category !== null).length >
    0
      ? covers.filter((b) => b.category === category)
      : covers.filter((b) => b.category === null).length > 0
        ? covers.filter((b) => b.category === null)
        : covers.filter((b) => b.category === "autre");
  if (pool.length === 0) return null;
  let h = 0;
  for (const ch of merchantId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

/** Attribue automatiquement une couverture de la banque à UN commerçant. */
export async function autoAssignCover(
  merchantId: string
): Promise<VisualActionState> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };
  const admin = createAdminClient();

  const [{ data: bank }, { data: m }] = await Promise.all([
    bankTable(admin)
      .select("id, kind, category, label, url, position, active")
      .eq("active", true)
      .order("position", { ascending: true }),
    admin
      .from("merchants")
      .select("id, category")
      .eq("id", merchantId)
      .single(),
  ]);
  if (!m) return { error: "Commerçant introuvable." };

  const img = pickBankCover(bank ?? [], m.category ?? null, merchantId);
  if (!img) return { error: "Aucun visuel disponible pour cette catégorie." };

  const { error } = await admin
    .from("merchants")
    .update({ cover_url: img.url })
    .eq("id", merchantId);
  if (error) return { error: error.message };

  await audit("visual_auto_cover", merchantId, img.label);
  revalidatePath("/admin/merchants/visuels");
  return { ok: true };
}

/**
 * Attribue une couverture à TOUS les commerçants qui n'en ont pas
 * (l'existant n'est jamais écrasé). Renvoie le nombre traité.
 */
export async function autoAssignMissingCovers(): Promise<VisualActionState> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };
  const admin = createAdminClient();

  const [{ data: bank }, { data: merchants }] = await Promise.all([
    bankTable(admin)
      .select("id, kind, category, label, url, position, active")
      .eq("active", true)
      .order("position", { ascending: true }),
    admin
      .from("merchants")
      .select("id, category, cover_url")
      .is("cover_url", null),
  ]);

  let count = 0;
  for (const m of merchants ?? []) {
    const img = pickBankCover(bank ?? [], m.category ?? null, m.id);
    if (!img) continue;
    const { error } = await admin
      .from("merchants")
      .update({ cover_url: img.url })
      .eq("id", m.id);
    if (!error) count++;
  }

  await audit("visual_auto_bulk", null, `${count} couverture(s) attribuée(s)`);
  revalidatePath("/admin/merchants/visuels");
  return { ok: true, count };
}

/** Ajoute une image à la banque (URL validée = image réelle). */
export async function addBankImage(input: {
  category: string | null;
  label: string;
  url: string;
}): Promise<VisualActionState> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };
  const label = input.label.trim();
  if (!label || label.length > 80) {
    return { error: "Libellé requis (80 caractères max)." };
  }
  const err = await validateImageUrl(input.url);
  if (err) return { error: err };

  const admin = createAdminClient();
  const { error } = await bankTable(admin).insert({
    kind: "cover",
    category: input.category || null,
    label,
    url: input.url.trim(),
    position: 1000, // les ajouts manuels passent après la sélection de base
  });
  if (error) {
    return {
      error: error.message.includes("duplicate")
        ? "Cette image est déjà dans la banque."
        : error.message,
    };
  }
  await audit("bank_image_add", null, label);
  revalidatePath("/admin/merchants/visuels");
  return { ok: true };
}

/** Retire une image de la banque (désactivation douce — jamais de casse :
 *  les commerçants qui l'utilisent déjà gardent leur couverture). */
export async function disableBankImage(id: string): Promise<VisualActionState> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { error } = await bankTable(admin)
    .update({ active: false })
    .eq("id", id);
  if (error) return { error: error.message };
  await audit("bank_image_disable", id);
  revalidatePath("/admin/merchants/visuels");
  return { ok: true };
}
