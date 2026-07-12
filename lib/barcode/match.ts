import { createAdminClient } from "@/lib/supabase/admin";

// =============================================================================
// Matching FLOU nom résolu → produits des commerçants (scan temps réel, façon
// Picnic). Le nom OpenFoodFacts/catalogue (« Coca-Cola Original 1 L ») ne
// correspond jamais mot pour mot au libellé du commerçant (« Coca cola 1l ») :
// on TOKENISE le nom (mots ≥ 3 lettres, accents pliés), on cherche les
// produits DISPONIBLES dont le nom contient AU MOINS un token (ILIKE), puis on
// classe par proportion de tokens retrouvés. Sécurité : lecture service_role
// mais UNIQUEMENT des données déjà publiques (produits disponibles de
// commerces actifs) — mêmes contours que la vitrine.
// =============================================================================

export type MatchedProduct = {
  product_id: string;
  name_fr: string;
  name_ar: string | null;
  unit: string;
  min_qty: number | null;
  max_qty: number | null;
  price_da: number;
  image_url: string | null;
  category: string | null;
  has_options: boolean;
  merchant: {
    id: string;
    slug: string;
    name: string;
    logo_url: string | null;
  };
};

const STOPWORDS = new Set([
  "the",
  "les",
  "des",
  "and",
  "avec",
  "pour",
  "original",
  "boisson",
  "produit",
]);

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Tokens de recherche : mots ≥ 3 lettres/chiffres, sans stopwords, max 5. */
export function nameTokens(name: string): string[] {
  return [
    ...new Set(
      normalize(name)
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    ),
  ].slice(0, 5);
}

type Row = {
  id: string;
  name_fr: string;
  name_ar: string | null;
  unit: string;
  min_qty: number | null;
  max_qty: number | null;
  price_da: number;
  image_url: string | null;
  category: string | null;
  product_option_groups: { id: string }[] | null;
  merchants: {
    id: string;
    slug: string;
    name: string;
    logo_url: string | null;
  } | null;
};

/** Base de requête commune : produits DISPONIBLES de commerces ACTIFS (mêmes
 *  contours que la vitrine publique), avec commerçant embarqué. */
function baseQuery(merchantId?: string | null) {
  const admin = createAdminClient();
  let query = admin
    .from("products")
    .select(
      `id, name_fr, name_ar, unit, min_qty, max_qty, price_da, image_url,
       category, product_option_groups ( id ),
       merchants!inner ( id, slug, name, logo_url, is_active )`
    )
    .is("archived_at", null)
    .eq("is_available", true)
    .eq("merchants.is_active", true)
    .or("stock_qty.is.null,stock_qty.gt.0");
  if (merchantId) query = query.eq("merchant_id", merchantId);
  return query;
}

function toMatched(rows: Row[]): MatchedProduct[] {
  return rows
    .filter((r) => r.merchants)
    .map((r) => ({
      product_id: r.id,
      name_fr: r.name_fr,
      name_ar: r.name_ar,
      unit: r.unit,
      min_qty: r.min_qty,
      max_qty: r.max_qty,
      price_da: r.price_da,
      image_url: r.image_url,
      category: r.category,
      has_options: (r.product_option_groups?.length ?? 0) > 0,
      merchant: {
        id: r.merchants!.id,
        slug: r.merchants!.slug,
        name: r.merchants!.name,
        logo_url: r.merchants!.logo_url,
      },
    }));
}

/**
 * Match EXACT par code-barres (phase 2, mig 0362) — PRIORITAIRE : le
 * commerçant a scanné/saisi l'EAN sur sa fiche produit, aucune ambiguïté.
 * Fonctionne même quand le code est inconnu du catalogue et d'OpenFoodFacts.
 */
export async function findExactBarcodeProducts(
  barcode: string,
  merchantId?: string | null
): Promise<MatchedProduct[]> {
  const { data } = await baseQuery(merchantId)
    // Colonne barcode (mig 0362) absente des types générés → cast.
    .eq("barcode" as never, barcode)
    .limit(20);
  return toMatched((data ?? []) as unknown as Row[]);
}

export async function findMatchingProducts(input: {
  resolvedName: string;
  merchantId?: string | null;
  limit?: number;
}): Promise<MatchedProduct[]> {
  const tokens = nameTokens(input.resolvedName);
  if (tokens.length === 0) return [];

  // Au moins UN token dans le nom (les tokens sont déjà [a-z0-9] → sûrs
  // dans la syntaxe .or de PostgREST).
  const { data } = await baseQuery(input.merchantId)
    .or(tokens.map((t) => `name_fr.ilike.%${t}%`).join(","))
    .limit(60);
  const rows = (data ?? []) as unknown as Row[];

  // Score = proportion de tokens retrouvés dans le nom du produit ; bonus si
  // le nom du produit est court (moins de bruit). Seuil : ≥ moitié des tokens
  // (1 seul token exigé si le nom n'en a qu'un ou deux).
  const need = tokens.length <= 2 ? 1 : Math.ceil(tokens.length / 2);
  const scored = rows
    .filter((r) => r.merchants)
    .map((r) => {
      const hay = normalize(r.name_fr);
      const hits = tokens.filter((t) => hay.includes(t)).length;
      return { r, hits, score: hits / tokens.length - hay.length / 1000 };
    })
    .filter((x) => x.hits >= need)
    .sort((a, b) => b.score - a.score || a.r.price_da - b.r.price_da)
    .slice(0, input.limit ?? 8);

  return toMatched(scored.map(({ r }) => r));
}
