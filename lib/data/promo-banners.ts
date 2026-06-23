// =============================================================================
// Bannières éditoriales — prompt 20 redesign.
// =============================================================================
// Lecture publique (RLS le permet) ; pas d'écriture côté client. La fenêtre
// active est déjà filtrée par la policy SQL (starts_at/ends_at).
// =============================================================================

import { createClient } from "@/lib/supabase/server";

export type PromoBanner = {
  id: string;
  title: string;
  subtitle: string | null;
  cta_label: string | null;
  image_url: string | null;
  image_fit: "cover" | "contain" | "overlay";
  link: string | null;
  accent: "violet" | "coral" | "mint" | "amber" | "dark";
  position: number;
};

/** Localisation de l'utilisateur pour le ciblage des bannières par zone. */
export type BannerViewerLocation = {
  lat: number | null;
  lng: number | null;
  wilaya: string | null;
  commune: string | null;
};

export async function getActiveBanners(
  loc?: BannerViewerLocation
): Promise<PromoBanner[]> {
  const supabase = await createClient();
  // RPC `active_banners_for` (mig 0249) : filtre déjà actif + fenêtre de dates
  // ET ciblage par ZONE (une bannière sans zone = globale ; sinon visible
  // seulement si l'utilisateur est dans l'une de ses zones). Hors types générés
  // → appel casté.
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown }>;
  const { data } = await rpc("active_banners_for", {
    p_lat: loc?.lat ?? null,
    p_lng: loc?.lng ?? null,
    p_wilaya: loc?.wilaya ?? null,
    p_commune: loc?.commune ?? null,
  });
  const rows = (data ?? []) as unknown as Array<
    Omit<PromoBanner, "image_fit"> & { image_fit?: string }
  >;
  return rows.map((b) => ({
    ...b,
    image_fit: (b.image_fit ?? "overlay") as PromoBanner["image_fit"],
  }));
}
