"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMerchantId } from "@/lib/auth/merchant";
import { translateToArabic, TRANSLATE_MAX_BATCH } from "@/lib/ai/translate";

/**
 * Traduction FR → AR à la demande pour les formulaires commerçant
 * (bouton « Traduire » à côté des champs arabes).
 *
 * Garde : réservée à un commerçant connecté (l'API Gemini est payée/quotée
 * côté plateforme — pas d'appel anonyme).
 */
export async function translateTextsAction(
  texts: string[]
): Promise<{ translations?: string[]; error?: string }> {
  const merchantId = await getCurrentMerchantId();
  if (!merchantId) return { error: "Session expirée." };

  if (
    !Array.isArray(texts) ||
    texts.length === 0 ||
    texts.length > 10 ||
    texts.some(
      (t) => typeof t !== "string" || t.trim().length === 0 || t.length > 2000
    )
  ) {
    return { error: "Texte à traduire invalide." };
  }

  const { translations, error } = await translateToArabic(texts);
  if (error || !translations)
    return { error: error ?? "Traduction indisponible." };
  return { translations };
}

/**
 * Complète EN LOT les traductions arabes manquantes du catalogue du
 * commerçant connecté : `name_ar` et `description_ar` des produits actifs.
 *
 * - Ne touche JAMAIS un champ arabe déjà rempli (aucun écrasement).
 * - Filtre explicite `.eq("merchant_id", …)` sur lecture ET écriture
 *   (la RLS publique expose les produits de tous les commerces actifs).
 */
export async function completeCatalogTranslationsAction(): Promise<{
  updated?: number;
  remaining?: number;
  error?: string;
}> {
  const merchantId = await getCurrentMerchantId();
  if (!merchantId) return { error: "Session expirée." };

  const supabase = await createClient();
  const { data: products, error: readError } = await supabase
    .from("products")
    .select("id, name_fr, name_ar, description_fr, description_ar")
    .eq("merchant_id", merchantId)
    .is("archived_at", null);
  if (readError) return { error: "Lecture du catalogue impossible." };

  // Un « item » = un champ à traduire, rattaché à son produit.
  const items: {
    productId: string;
    column: "name_ar" | "description_ar";
    text: string;
  }[] = [];
  for (const p of products ?? []) {
    if (!p.name_ar?.trim() && p.name_fr?.trim()) {
      items.push({ productId: p.id, column: "name_ar", text: p.name_fr });
    }
    if (!p.description_ar?.trim() && p.description_fr?.trim()) {
      items.push({
        productId: p.id,
        column: "description_ar",
        text: p.description_fr,
      });
    }
  }
  if (items.length === 0) return { updated: 0, remaining: 0 };

  // On borne le travail par action (les très gros catalogues relancent le
  // bouton : l'action indique le restant) pour rester sous les timeouts
  // serverless et les quotas par requête Gemini.
  const MAX_ITEMS_PER_RUN = 4 * TRANSLATE_MAX_BATCH; // 160 champs
  const batchItems = items.slice(0, MAX_ITEMS_PER_RUN);

  const perProduct = new Map<
    string,
    Partial<Record<"name_ar" | "description_ar", string>>
  >();
  for (let i = 0; i < batchItems.length; i += TRANSLATE_MAX_BATCH) {
    const chunk = batchItems.slice(i, i + TRANSLATE_MAX_BATCH);
    const { translations, error } = await translateToArabic(
      chunk.map((c) => c.text)
    );
    if (error || !translations) {
      // Panne en cours de lot : on enregistre ce qui a déjà été traduit puis
      // on remonte l'erreur (relancer reprendra là où on s'est arrêté).
      if (perProduct.size === 0)
        return { error: error ?? "Traduction indisponible." };
      break;
    }
    chunk.forEach((c, j) => {
      const patch = perProduct.get(c.productId) ?? {};
      patch[c.column] = translations[j];
      perProduct.set(c.productId, patch);
    });
  }

  let updated = 0;
  for (const [productId, patch] of perProduct) {
    const { error: writeError } = await supabase
      .from("products")
      .update(patch)
      .eq("id", productId)
      .eq("merchant_id", merchantId);
    if (!writeError) updated += Object.keys(patch).length;
  }

  revalidatePath("/catalog");
  const remaining =
    items.length - batchItems.length + (batchItems.length - updated);
  return { updated, remaining: Math.max(0, remaining) };
}
