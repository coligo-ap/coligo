"use server";

import { getFeatureFlags } from "@/lib/data/feature-flags";
import {
  isValidBarcode,
  resolveBarcode,
  type BarcodeSurface,
} from "@/lib/barcode/resolve";

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
