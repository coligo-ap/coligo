import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { BLOG_ARTICLES } from "@/lib/config/blog";

// =============================================================================
// sitemap.xml — uniquement les pages PUBLIQUES : accueil, pages statiques
// (légal, aide, contact, blog) et toutes les boutiques /m/[slug] actives
// (lues via le client ANON — RLS de merchants_public = données publiques).
// Fail-soft : une erreur DB rend quand même le sitemap statique.
// =============================================================================

export const revalidate = 3600; // 1 h — les nouvelles boutiques apparaissent vite

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://coligo.app").replace(
  /\/+$/,
  ""
);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/services`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/app`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/contact`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${BASE}/centre-aide`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/blog`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/recrute`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/cgu`, changeFrequency: "yearly", priority: 0.2 },
    {
      url: `${BASE}/confidentialite`,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${BASE}/mentions-legales`,
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ];

  const blogPages: MetadataRoute.Sitemap = BLOG_ARTICLES.map((a) => ({
    url: `${BASE}/blog/${a.slug}`,
    lastModified: new Date(a.publishedAt),
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  // Boutiques publiques — le cœur SEO de la marketplace.
  let merchantPages: MetadataRoute.Sitemap = [];
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("merchants_public")
      .select("slug")
      .limit(5000);
    merchantPages = (data ?? [])
      .filter((m): m is { slug: string } => !!m.slug)
      .map((m) => ({
        url: `${BASE}/m/${m.slug}`,
        changeFrequency: "daily" as const,
        priority: 0.8,
      }));
  } catch {
    /* fail-soft : sitemap statique quand même */
  }

  return [...staticPages, ...blogPages, ...merchantPages];
}
