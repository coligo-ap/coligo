// =============================================================================
// Helpers chemins Supabase Storage — partagés entre Server Actions.
// =============================================================================

/**
 * Extrait le chemin interne ({merchantId}/uuid.ext) d'une URL publique Storage
 * du bucket `products` (…/object/public/products/<path>). null si non reconnu.
 */
export function productsStoragePathFromPublicUrl(
  url: string | null
): string | null {
  if (!url) return null;
  const prefix = "/object/public/products/";
  const i = url.indexOf(prefix);
  if (i === -1) return null;
  return url.slice(i + prefix.length).split("?")[0] || null;
}
