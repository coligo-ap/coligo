"use server";

import { getFeatureFlags } from "@/lib/data/feature-flags";
import {
  isValidBarcode,
  resolveBarcode,
  type BarcodeSurface,
} from "@/lib/barcode/resolve";
import {
  findExactBarcodeProducts,
  findMatchingProducts,
  type MatchedProduct,
} from "@/lib/barcode/match";

// =============================================================================
// Scan code-barres côté CLIENT (phase 1) — relaye vers lib/barcode/resolve
// APRÈS la garde feature-flag de la surface (kill-switch super-admin par
// surface : accueil marketplace / fiche commerçant, cf. /admin/controle).
// =============================================================================

export type ScanBarcodeResult =
  | { ok: true; name: string; brand: string | null }
  | { ok: false; error: "disabled" | "invalid" | "not_found" };

export async function scanBarcode(input: {
  ean: string;
  surface: BarcodeSurface;
}): Promise<ScanBarcodeResult> {
  const surface: BarcodeSurface =
    input.surface === "merchant" ? "merchant" : "marketplace";
  const flags = await getFeatureFlags();
  const key =
    surface === "marketplace" ? "barcode_marketplace" : "barcode_merchant";
  if (flags[key].status !== "active") return { ok: false, error: "disabled" };

  const ean = (input.ean ?? "").replace(/\D/g, "");
  if (!isValidBarcode(ean)) return { ok: false, error: "invalid" };

  const hit = await resolveBarcode(ean, surface);
  if (!hit) return { ok: false, error: "not_found" };
  return { ok: true, name: hit.name, brand: hit.brand };
}

// ─── Scan TEMPS RÉEL (façon Picnic) : code → nom → PRODUITS correspondants ──

export type ScanFindResult =
  | {
      ok: true;
      /** Nom résolu du code (catalogue local / OpenFoodFacts). */
      name: string;
      /** Produits DISPONIBLES correspondants (fiche : ce commerçant seul ;
       *  accueil : tous les commerces actifs), classés par ressemblance. */
      products: MatchedProduct[];
    }
  | { ok: false; error: "disabled" | "invalid" | "not_found" };

export async function scanBarcodeFind(input: {
  ean: string;
  surface: BarcodeSurface;
  /** Fiche commerçant : borne la recherche à CE commerce. */
  merchantId?: string | null;
}): Promise<ScanFindResult> {
  const surface: BarcodeSurface =
    input.surface === "merchant" ? "merchant" : "marketplace";
  const flags = await getFeatureFlags();
  const key =
    surface === "marketplace" ? "barcode_marketplace" : "barcode_merchant";
  if (flags[key].status !== "active") return { ok: false, error: "disabled" };

  const ean = (input.ean ?? "").replace(/\D/g, "");
  if (!isValidBarcode(ean)) return { ok: false, error: "invalid" };

  const merchantId = surface === "merchant" ? (input.merchantId ?? null) : null;

  // 1) Match EXACT par products.barcode (phase 2) — PRIORITAIRE, et suffisant
  //    même si le code est inconnu du catalogue et d'OpenFoodFacts.
  // 2) Résolution du NOM (toujours : journal + auto-enrichissement) → matching
  //    flou en complément, dédoublonné derrière les matchs exacts.
  const [exact, hit] = await Promise.all([
    findExactBarcodeProducts(ean, merchantId),
    resolveBarcode(ean, surface),
  ]);
  const fuzzy = hit
    ? await findMatchingProducts({
        resolvedName: [hit.brand, hit.name].filter(Boolean).join(" "),
        merchantId,
      })
    : [];
  const seen = new Set(exact.map((p) => p.product_id));
  const products = [
    ...exact,
    ...fuzzy.filter((p) => !seen.has(p.product_id)),
  ].slice(0, 8);

  const name = hit?.name ?? exact[0]?.name_fr;
  if (!name) return { ok: false, error: "not_found" };
  return { ok: true, name, products };
}
