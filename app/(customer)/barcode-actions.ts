"use server";

import { getFeatureFlags } from "@/lib/data/feature-flags";
import {
  isValidBarcode,
  resolveBarcode,
  type BarcodeSurface,
} from "@/lib/barcode/resolve";
import { findMatchingProducts, type MatchedProduct } from "@/lib/barcode/match";

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

  const hit = await resolveBarcode(ean, surface);
  if (!hit) return { ok: false, error: "not_found" };

  const products = await findMatchingProducts({
    resolvedName: [hit.brand, hit.name].filter(Boolean).join(" "),
    merchantId: surface === "merchant" ? (input.merchantId ?? null) : null,
  });
  return { ok: true, name: hit.name, products };
}
