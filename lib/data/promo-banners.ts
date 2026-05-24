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
  link: string | null;
  accent: "violet" | "coral" | "mint" | "amber" | "dark";
  position: number;
};

export async function getActiveBanners(): Promise<PromoBanner[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("promo_banners")
    .select("id, title, subtitle, cta_label, image_url, link, accent, position")
    .order("position", { ascending: true })
    .limit(10);
  return (data ?? []) as PromoBanner[];
}
