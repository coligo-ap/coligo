"use server";

import { revalidatePath } from "next/cache";
import { adminCan } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidBarcode } from "@/lib/barcode/resolve";

// =============================================================================
// Gestion du CATALOGUE code-barres par les super-admins (domaine plateforme) :
// ajout/correction (source 'admin' = prioritaire sur OpenFoodFacts), et
// suppression. Les scans non résolus remontent sur la page pour enrichir.
// =============================================================================

export async function upsertBarcode(input: {
  barcode: string;
  productName: string;
  brand?: string | null;
}): Promise<{ error?: string }> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
  const barcode = (input.barcode ?? "").replace(/\D/g, "");
  const name = (input.productName ?? "").trim();
  if (!isValidBarcode(barcode)) {
    return { error: "Code-barres invalide (8 à 14 chiffres)." };
  }
  if (!name) return { error: "Le nom du produit est requis." };

  const admin = createAdminClient();
  const { error } = await admin.from("barcode_catalog" as never).upsert(
    {
      barcode,
      product_name: name.slice(0, 120),
      brand: input.brand?.trim().slice(0, 60) || null,
      source: "admin",
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "barcode" }
  );
  if (error) return { error: error.message };
  revalidatePath("/admin/codes-barres");
  return {};
}

export async function deleteBarcode(
  barcode: string
): Promise<{ error?: string }> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("barcode_catalog" as never)
    .delete()
    .eq("barcode", barcode);
  if (error) return { error: error.message };
  revalidatePath("/admin/codes-barres");
  return {};
}
