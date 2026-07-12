import { createAdminClient } from "@/lib/supabase/admin";

// =============================================================================
// Résolution d'un CODE-BARRES (EAN-8/13, UPC) → nom de produit (phase 1).
// Ordre : 1) catalogue LOCAL barcode_catalog (source de vérité, géré par les
// super-admins) ; 2) repli OpenFoodFacts (gratuit, bonne couverture des
// produits FMCG vendus en Algérie) — chaque hit OFF est AUTO-ENRICHI dans le
// catalogue local (source 'openfoodfacts'), qui devient la base algérienne au
// fil de l'eau. Tous les scans sont journalisés (barcode_scan_log) : les non
// résolus remontent sur /admin/codes-barres pour enrichissement manuel.
// =============================================================================

export type BarcodeSurface = "marketplace" | "merchant";
export type BarcodeHit = {
  name: string;
  brand: string | null;
  source: "admin" | "openfoodfacts";
};

export function isValidBarcode(raw: string): boolean {
  return /^[0-9]{8,14}$/.test(raw);
}

type CatalogRow = {
  barcode: string;
  product_name: string;
  brand: string | null;
  source: "admin" | "openfoodfacts";
};

/** Journalise le scan (best-effort : ne bloque jamais la réponse). */
async function logScan(
  barcode: string,
  surface: BarcodeSurface,
  hit: BarcodeHit | null
) {
  try {
    const admin = createAdminClient();
    await admin.from("barcode_scan_log" as never).insert({
      barcode,
      resolved: hit != null,
      source: hit?.source ?? null,
      product_name: hit?.name ?? null,
      surface,
    } as never);
  } catch {
    /* journal best-effort */
  }
}

/** Repli OpenFoodFacts — nom FR prioritaire, timeout court, fail-soft. */
async function fetchOpenFoodFacts(barcode: string): Promise<BarcodeHit | null> {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=product_name,product_name_fr,brands`,
      {
        signal: AbortSignal.timeout(4000),
        headers: { "User-Agent": "Coligo-DZ/1.0 (marketplace)" },
      }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status?: number;
      product?: {
        product_name?: string;
        product_name_fr?: string;
        brands?: string;
      };
    };
    const p = json.product;
    const name = (p?.product_name_fr || p?.product_name || "").trim();
    if (json.status !== 1 || !name) return null;
    return {
      name: name.slice(0, 120),
      brand: p?.brands?.split(",")[0]?.trim().slice(0, 60) || null,
      source: "openfoodfacts",
    };
  } catch {
    return null; // réseau/timeout → traité comme non résolu (jamais bloquant)
  }
}

export async function resolveBarcode(
  barcode: string,
  surface: BarcodeSurface
): Promise<BarcodeHit | null> {
  const admin = createAdminClient();

  // 1) Catalogue local — la saisie admin PRIME toujours.
  const { data } = await admin
    .from("barcode_catalog" as never)
    .select("barcode, product_name, brand, source")
    .eq("barcode", barcode)
    .maybeSingle();
  const local = data as CatalogRow | null;
  if (local) {
    const hit: BarcodeHit = {
      name: local.product_name,
      brand: local.brand,
      source: local.source,
    };
    void logScan(barcode, surface, hit);
    return hit;
  }

  // 2) Repli OpenFoodFacts + auto-enrichissement du catalogue (best-effort).
  const off = await fetchOpenFoodFacts(barcode);
  if (off) {
    try {
      await admin.from("barcode_catalog" as never).upsert(
        {
          barcode,
          product_name: off.name,
          brand: off.brand,
          source: "openfoodfacts",
        } as never,
        { onConflict: "barcode", ignoreDuplicates: true }
      );
    } catch {
      /* enrichissement best-effort — la réponse au client prime */
    }
  }
  void logScan(barcode, surface, off);
  return off;
}
