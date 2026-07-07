import { createClient } from "@/lib/supabase/server";
import { listPublicMerchants, type PublicMerchant } from "./merchants-public";
import { getAllCategories } from "./categories";

// =============================================================================
// Recherche par PRODUIT (volet 2) — le client cherche un produit, on remonte
// les COMMERÇANTS qui l'ont, avec leurs produits trouvés (carrousel côté UI).
// Couverture, par ordre : produits (titres) → tags → catégories → noms.
// Tolérance fautes/accents : assurée côté SQL par la RPC search_products_in_zone
// (pg_trgm + unaccent) ; le matching tags/catégorie/nom se fait ici en JS sur
// une forme normalisée (sans accent, minuscule).
// =============================================================================

export type SearchProduct = {
  id: string;
  merchant_id: string;
  name_fr: string;
  name_ar: string | null;
  price_da: number;
  image_url: string | null;
  is_available: boolean;
  stock_qty: number | null;
  /** Unité de vente (piece, kg, L, m…) — garde « pas d'ajout aveugle ». */
  unit: string;
  min_qty: number | null;
  max_qty: number | null;
  /** Produit à options/variantes → le « + » doit ouvrir la fiche, pas ajouter. */
  has_options: boolean;
};

export type ProductMatchKind = "product" | "tag" | "category" | "name";

export type ProductSearchGroup = {
  merchant: PublicMerchant;
  /** Produits trouvés (titre matché) OU échantillon (match tag/catégorie/nom). */
  products: SearchProduct[];
  matchKind: ProductMatchKind;
  /** Prix le plus bas parmi les produits affichés (tri « moins cher » + badge). */
  cheapestDa: number | null;
  /** Score de pertinence (tri « Pertinents » par défaut, calculé serveur). */
  relevance: number;
};

export type ProductSearchOutcome = {
  query: string;
  groups: ProductSearchGroup[];
};

/** Normalisation : minuscule + sans accents (NFD) — pour comparaisons JS. */
function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

const MAX_SAMPLE_PER_MERCHANT = 10;
const MAX_NON_PRODUCT_MERCHANTS = 12;

export async function searchProductsInZone(input: {
  q: string;
  wilaya_code?: string | null;
  commune?: string | null;
}): Promise<ProductSearchOutcome> {
  const q = (input.q ?? "").trim();
  if (q.length < 2) return { query: q, groups: [] };
  const qn = norm(q);

  const supabase = await createClient();

  // 1) Commerçants éligibles de la zone (vue publique → champs complets + tags).
  const zoneMerchants = await listPublicMerchants({
    wilaya_code: input.wilaya_code ?? null,
    commune: input.commune ?? null,
    limit: 200,
  });
  const byId = new Map(zoneMerchants.map((m) => [m.id, m]));

  // 2) Produits dont le titre matche (RPC trigram/unaccent).
  // La RPC 0082 n'est pas (encore) dans database.types.ts → on cast le nom et
  // les args (`as never`), comme pour les autres RPC récentes.
  const { data: rpcRows } = await supabase.rpc(
    "search_products_in_zone" as never,
    {
      p_q: q,
      p_wilaya: input.wilaya_code ?? null,
      p_commune: input.commune ?? null,
      p_limit: 200,
    } as never
  );

  const productsByMerchant = new Map<
    string,
    { products: SearchProduct[]; maxSim: number }
  >();
  for (const row of (rpcRows ?? []) as (SearchProduct & { sim: number })[]) {
    if (!byId.has(row.merchant_id)) continue; // hors zone publique
    const entry = productsByMerchant.get(row.merchant_id) ?? {
      products: [],
      maxSim: 0,
    };
    if (entry.products.length < MAX_SAMPLE_PER_MERCHANT) {
      entry.products.push({
        id: row.id,
        merchant_id: row.merchant_id,
        name_fr: row.name_fr,
        name_ar: row.name_ar,
        price_da: row.price_da,
        image_url: row.image_url,
        is_available: row.is_available,
        stock_qty: row.stock_qty,
        unit: row.unit ?? "piece",
        min_qty: row.min_qty,
        max_qty: row.max_qty,
        has_options: row.has_options === true,
      });
    }
    entry.maxSim = Math.max(entry.maxSim, Number(row.sim) || 0);
    productsByMerchant.set(row.merchant_id, entry);
  }

  // 3) Match tags / catégorie / nom (en JS, sur la forme normalisée) pour les
  //    commerçants qui n'ont PAS déjà un match produit. Libellés pilotés en
  //    base (renommages/créations admin matchés) — repli statique intégré à
  //    getAllCategories si la DB ne répond pas.
  const allCategories = await getAllCategories();
  const catLabelsByCode = new Map(
    allCategories.map((c) => [
      c.code,
      [norm(c.code), norm(c.label), norm(c.labelAr)],
    ])
  );
  const nonProductMatches: {
    merchant: PublicMerchant;
    kind: ProductMatchKind;
  }[] = [];
  for (const m of zoneMerchants) {
    if (productsByMerchant.has(m.id)) continue;
    const tags = (m.tags ?? []).map(norm);
    if (tags.some((tg) => tg.includes(qn) || qn.includes(tg))) {
      nonProductMatches.push({ merchant: m, kind: "tag" });
      continue;
    }
    const catForms = m.category
      ? (catLabelsByCode.get(m.category) ?? [norm(m.category)])
      : [];
    if (catForms.some((cf) => cf.includes(qn) || qn.includes(cf))) {
      nonProductMatches.push({ merchant: m, kind: "category" });
      continue;
    }
    if (norm(m.name).includes(qn)) {
      nonProductMatches.push({ merchant: m, kind: "name" });
    }
  }
  nonProductMatches.splice(MAX_NON_PRODUCT_MERCHANTS);

  // 3b) Échantillon de produits dispo pour les matches tag/catégorie/nom.
  const sampleByMerchant = new Map<string, SearchProduct[]>();
  const sampleIds = nonProductMatches.map((x) => x.merchant.id);
  if (sampleIds.length > 0) {
    const { data: sampleRows } = await supabase
      .from("products")
      .select(
        "id, merchant_id, name_fr, name_ar, price_da, image_url, is_available, stock_qty, unit, min_qty, max_qty, position, product_option_groups ( id )"
      )
      .in("merchant_id", sampleIds)
      .eq("is_available", true)
      .order("position", { ascending: true });
    for (const r of (sampleRows ?? []) as (Omit<
      SearchProduct,
      "has_options"
    > & {
      position: number | null;
      product_option_groups: { id: string }[] | null;
    })[]) {
      const list = sampleByMerchant.get(r.merchant_id) ?? [];
      if (list.length < MAX_SAMPLE_PER_MERCHANT) {
        list.push({
          id: r.id,
          merchant_id: r.merchant_id,
          name_fr: r.name_fr,
          name_ar: r.name_ar,
          price_da: r.price_da,
          image_url: r.image_url,
          is_available: r.is_available,
          stock_qty: r.stock_qty,
          unit: r.unit ?? "piece",
          min_qty: r.min_qty,
          max_qty: r.max_qty,
          has_options: (r.product_option_groups?.length ?? 0) > 0,
        });
      }
      sampleByMerchant.set(r.merchant_id, list);
    }
  }

  // 4) Construit les groupes + score de pertinence.
  const KIND_WEIGHT: Record<ProductMatchKind, number> = {
    product: 3,
    tag: 2,
    name: 1.4,
    category: 1,
  };
  const groups: ProductSearchGroup[] = [];

  for (const [merchantId, entry] of productsByMerchant) {
    const merchant = byId.get(merchantId)!;
    const cheapest = entry.products.reduce<number | null>(
      (min, p) => (min == null ? p.price_da : Math.min(min, p.price_da)),
      null
    );
    groups.push({
      merchant,
      products: entry.products,
      matchKind: "product",
      cheapestDa: cheapest,
      // Pertinence = match produit + qualité/rapidité MESURÉES (volet 3).
      relevance:
        KIND_WEIGHT.product +
        entry.maxSim +
        0.6 * merchant.score_quality +
        0.3 * merchant.score_speed,
    });
  }

  for (const { merchant, kind } of nonProductMatches) {
    const products = sampleByMerchant.get(merchant.id) ?? [];
    const cheapest = products.reduce<number | null>(
      (min, p) => (min == null ? p.price_da : Math.min(min, p.price_da)),
      null
    );
    groups.push({
      merchant,
      products,
      matchKind: kind,
      cheapestDa: cheapest,
      relevance:
        KIND_WEIGHT[kind] +
        0.6 * merchant.score_quality +
        0.3 * merchant.score_speed,
    });
  }

  // Tri « Pertinents » par défaut (le client peut réordonner via les pilules).
  groups.sort((a, b) => b.relevance - a.relevance);

  return { query: q, groups };
}
