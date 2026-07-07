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
 *
 * Mig 0336 : la visibilité par surface est portée par deux interrupteurs
 * (show_marketplace / show_signup) qui priment sur `kind` pour l'affichage —
 * `kind` reste la nature outillage (filter = mapping auto, suppression libre).
 */

export type CategoryRow = MerchantCategory & {
  imageUrl: string | null;
  position: number;
  status: "active" | "hidden" | "coming_soon";
  /** type = proposé à l'inscription ; filter = filtre éditorial (phase 3). */
  kind: "type" | "filter";
  /** Affichée dans le strip de filtres du marketplace (mig 0336). */
  showMarketplace: boolean;
  /** Proposée à l'inscription / réglages commerçant (mig 0336). */
  showSignup: boolean;
};

type DbRow = {
  code: string;
  label: string;
  label_ar: string;
  emoji: string;
  image_url: string | null;
  position: number;
  status: string;
  kind: string;
  show_marketplace: boolean;
  show_signup: boolean;
};

/** Toutes les catégories (tous statuts), ordonnées — admin + sélecteurs. */
export async function getAllCategories(): Promise<CategoryRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("merchant_categories" as never)
    .select(
      "code, label, label_ar, emoji, image_url, position, status, kind, show_marketplace, show_signup"
    )
    .order("position", { ascending: true });
  const rows = (data ?? []) as unknown as DbRow[];
  if (rows.length === 0) {
    // Repli config statique (DB indisponible) : tout « actif », visible partout.
    return MERCHANT_CATEGORIES.map((c, i) => ({
      ...c,
      imageUrl: null,
      position: (i + 1) * 10,
      status: "active" as const,
      kind: "type" as const,
      showMarketplace: true,
      showSignup: true,
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
    kind: r.kind === "filter" ? ("filter" as const) : ("type" as const),
    showMarketplace: r.show_marketplace !== false,
    showSignup: r.show_signup !== false,
  }));
}

/** Catégories proposables à l'INSCRIPTION : show_signup + non masquées
 *  (« bientôt disponible » reste listée, grisée côté UI). */
export async function getSignupCategories(): Promise<CategoryRow[]> {
  return (await getAllCategories()).filter(
    (c) => c.showSignup && c.status !== "hidden"
  );
}

/**
 * GARDE SERVEUR : le code choisi à l'inscription / dans les réglages doit être
 * ACTIF et affiché à l'inscription (bypass-proof : statut masqué/bientôt OU
 * show_signup désactivé refusés même si le client force la valeur).
 */
export async function isActiveCategory(code: string): Promise<boolean> {
  const all = await getAllCategories();
  return all.some(
    (c) => c.code === code && c.status === "active" && c.showSignup
  );
}
