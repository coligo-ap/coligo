import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Revalidation SERVEUR des options/variantes choisies — source unique partagée
 * par l'aperçu checkout (context.ts) ET la création de commande (actions.ts),
 * pour que le total AFFICHÉ soit toujours égal au total FACTURÉ.
 *
 * Règle d'or : on ne fait JAMAIS confiance au prix/delta envoyé par le client.
 * Chaque option est rechargée par son id, on vérifie qu'elle appartient bien au
 * produit de SA ligne, et on RECALCULE le delta depuis la base.
 */

export type LineOptionInfo = {
  product_id: string;
  group_name_fr: string;
  group_name_ar: string | null;
  option_name_fr: string;
  option_name_ar: string | null;
  price_delta_da: number;
};

type ItemLite = {
  product_id: string;
  options?: { option_id: string }[];
};

/**
 * Retourne, PAR LIGNE (même index que `items`), le snapshot des options
 * revalidées + la somme des deltas à ajouter au prix de base.
 */
export async function loadLineOptions(
  supabase: SupabaseClient<Database>,
  items: ItemLite[]
): Promise<{ perLine: LineOptionInfo[][]; deltaPerLine: number[] }> {
  const allIds = Array.from(
    new Set(items.flatMap((it) => (it.options ?? []).map((o) => o.option_id)))
  );

  const byId = new Map<string, LineOptionInfo>();
  if (allIds.length > 0) {
    const { data } = await supabase
      .from("product_options")
      .select(
        `id, name_fr, name_ar, price_delta_da, is_available,
         product_option_groups!inner ( name_fr, name_ar, product_id )`
      )
      .in("id", allIds);
    type Raw = {
      id: string;
      name_fr: string;
      name_ar: string | null;
      price_delta_da: number;
      is_available: boolean;
      product_option_groups: {
        name_fr: string;
        name_ar: string | null;
        product_id: string;
      };
    };
    for (const r of (data ?? []) as unknown as Raw[]) {
      if (!r.is_available) continue;
      byId.set(r.id, {
        product_id: r.product_option_groups.product_id,
        group_name_fr: r.product_option_groups.name_fr,
        group_name_ar: r.product_option_groups.name_ar,
        option_name_fr: r.name_fr,
        option_name_ar: r.name_ar,
        price_delta_da: r.price_delta_da,
      });
    }
  }

  const perLine = items.map((it) => {
    const out: LineOptionInfo[] = [];
    for (const sel of it.options ?? []) {
      const info = byId.get(sel.option_id);
      // L'option doit exister, être dispo ET appartenir au produit de la ligne.
      if (!info || info.product_id !== it.product_id) continue;
      out.push(info);
    }
    return out;
  });
  const deltaPerLine = perLine.map((opts) =>
    opts.reduce((s, o) => s + o.price_delta_da, 0)
  );
  return { perLine, deltaPerLine };
}
