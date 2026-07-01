"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMerchantId } from "@/lib/auth/merchant";

/**
 * Options / variantes d'un produit (façon Deliveroo). Gérées à part du
 * formulaire produit (FormData) car la structure est imbriquée (groupes →
 * options). La RLS `opt_groups_all_own` / `options_all_own` garantit qu'un
 * commerçant ne touche QUE les options de SES produits → bypass-proof même si
 * `productId` est falsifié (le DELETE ne voit rien, l'INSERT WITH CHECK échoue).
 */

export type OptionInput = {
  name_fr: string;
  name_ar?: string | null;
  price_delta_da: number;
  is_available: boolean;
};

export type OptionGroupInput = {
  name_fr: string;
  name_ar?: string | null;
  /** 0 = facultatif, 1 = requis (au moins un choix). */
  min_select: number;
  /** 1 = variante exclusive (radio), > 1 = multi-choix (cases). */
  max_select: number;
  options: OptionInput[];
};

export type LoadedOptionGroup = OptionGroupInput & { id: string };

/**
 * Charge les groupes d'options + options d'un produit, triés par position.
 *
 * Action directement appelable → on VÉRIFIE la propriété du produit. La RLS
 * seule ne suffit PAS en lecture : `opt_groups_select_public` (mig 0262) rend
 * les options de tout produit disponible lisibles (nécessaire à la vitrine
 * client). Sans cette garde, un `productId` étranger renverrait les options
 * d'une autre boutique. (Les écritures, elles, restent bornées par
 * `opt_groups_all_own` WITH CHECK.)
 */
export async function getProductOptions(
  productId: string
): Promise<LoadedOptionGroup[]> {
  const merchantId = await getCurrentMerchantId();
  if (!merchantId) return [];
  const supabase = await createClient();
  const { data: owned } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("merchant_id", merchantId)
    .maybeSingle();
  if (!owned) return [];
  const { data } = await supabase
    .from("product_option_groups")
    .select(
      `id, name_fr, name_ar, min_select, max_select, position,
       product_options ( id, name_fr, name_ar, price_delta_da, is_available, position )`
    )
    .eq("product_id", productId)
    .order("position", { ascending: true });

  return ((data ?? []) as unknown as RawGroup[]).map((g) => ({
    id: g.id,
    name_fr: g.name_fr,
    name_ar: g.name_ar,
    min_select: g.min_select,
    max_select: g.max_select,
    options: (g.product_options ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((o) => ({
        name_fr: o.name_fr,
        name_ar: o.name_ar,
        price_delta_da: o.price_delta_da,
        is_available: o.is_available,
      })),
  }));
}

type RawGroup = {
  id: string;
  name_fr: string;
  name_ar: string | null;
  min_select: number;
  max_select: number;
  position: number;
  product_options: {
    name_fr: string;
    name_ar: string | null;
    price_delta_da: number;
    is_available: boolean;
    position: number;
  }[];
};

/**
 * Remplace l'INTÉGRALITÉ des options d'un produit (purge + ré-insertion
 * ordonnée). Sûr car les commandes snapshotent les libellés (aucun FK depuis
 * order_item_options vers product_options) → supprimer/recréer n'altère aucun
 * ticket déjà émis.
 */
export async function saveProductOptions(
  productId: string,
  groups: OptionGroupInput[]
): Promise<{ error?: string }> {
  const supabase = await createClient();

  // 1) Purge des groupes existants (CASCADE → options). RLS filtre sur la
  //    propriété : un productId non possédé ne supprime rien.
  const { error: delErr } = await supabase
    .from("product_option_groups")
    .delete()
    .eq("product_id", productId);
  if (delErr) return { error: delErr.message };

  // 2) Ré-insertion ordonnée. WITH CHECK (RLS) bloque un productId non possédé.
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const nameFr = g.name_fr.trim();
    if (!nameFr) continue; // groupe vide ignoré

    const minSel = Math.max(0, Math.round(g.min_select) || 0);
    const maxSel = Math.max(minSel || 1, Math.round(g.max_select) || 1);

    const { data: grow, error: gErr } = await supabase
      .from("product_option_groups")
      .insert({
        product_id: productId,
        name_fr: nameFr,
        name_ar: g.name_ar?.trim() || null,
        min_select: minSel,
        max_select: maxSel,
        position: gi,
      })
      .select("id")
      .single();
    if (gErr || !grow) {
      return { error: gErr?.message ?? "Échec d'enregistrement des options." };
    }

    const opts = g.options
      .filter((o) => o.name_fr.trim())
      .map((o, oi) => ({
        group_id: grow.id,
        name_fr: o.name_fr.trim(),
        name_ar: o.name_ar?.trim() || null,
        price_delta_da: Math.round(o.price_delta_da) || 0,
        is_available: o.is_available,
        position: oi,
      }));
    if (opts.length) {
      const { error: oErr } = await supabase
        .from("product_options")
        .insert(opts);
      if (oErr) return { error: oErr.message };
    }
  }

  revalidatePath(`/catalog/${productId}`);
  revalidatePath("/catalog");
  return {};
}
