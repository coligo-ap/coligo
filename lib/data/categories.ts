import { createClient } from "@/lib/supabase/server";
import {
  MERCHANT_CATEGORIES,
  type MerchantCategory,
} from "@/lib/config/categories";

/**
 * PHASE 1 catégories : la liste des types de commerçants vit EN BASE
 * (merchant_categories, mig 0311) — statuts active / hidden / coming_soon
 * pilotés par le super-admin. La config statique reste le REPLI (DB
 * inaccessible) et la source des types TS.
 */

export type CategoryRow = MerchantCategory & {
  imageUrl: string | null;
  position: number;
  status: "active" | "hidden" | "coming_soon";
};

type DbRow = {
  code: string;
  label: string;
  label_ar: string;
  emoji: string;
  image_url: string | null;
  position: number;
  status: string;
};

/** Toutes les catégories (tous statuts), ordonnées — admin + sélecteurs. */
export async function getAllCategories(): Promise<CategoryRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("merchant_categories" as never)
    .select("code, label, label_ar, emoji, image_url, position, status")
    .order("position", { ascending: true });
  const rows = (data ?? []) as unknown as DbRow[];
  if (rows.length === 0) {
    // Repli config statique (DB indisponible) : tout « actif ».
    return MERCHANT_CATEGORIES.map((c, i) => ({
      ...c,
      imageUrl: null,
      position: (i + 1) * 10,
      status: "active" as const,
    }));
  }
  return rows.map((r) => ({
    code: r.code,
    label: r.label,
    labelAr: r.label_ar,
    emoji: r.emoji,
    imageUrl: r.image_url,
    position: r.position,
    status:
      r.status === "hidden" || r.status === "coming_soon" ? r.status : "active",
  }));
}

/** Catégories proposables à l'INSCRIPTION : actives + « bientôt » (grisées). */
export async function getSignupCategories(): Promise<CategoryRow[]> {
  return (await getAllCategories()).filter((c) => c.status !== "hidden");
}

/**
 * GARDE SERVEUR : le code choisi à l'inscription / dans les réglages doit être
 * une catégorie ACTIVE (bypass-proof : un statut masqué/bientôt est refusé
 * même si le client force la valeur).
 */
export async function isActiveCategory(code: string): Promise<boolean> {
  const all = await getAllCategories();
  return all.some((c) => c.code === code && c.status === "active");
}
