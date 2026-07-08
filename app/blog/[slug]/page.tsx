import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock3 } from "lucide-react";
import { getFeatureFlags, isVisible } from "@/lib/data/feature-flags";
import { BLOG_ARTICLES, blogArticle, blogDateLabel } from "@/lib/config/blog";
import { CATEGORY_IMAGES } from "@/lib/images/category-images";
import { cldUrl } from "@/lib/images/cloudinary";

// =============================================================================
// /blog/[slug] — page article. 404 si slug inconnu OU si l'article présente un
// service masqué par le super-admin (cohérent avec la liste et les CGU).
// =============================================================================

export function generateStaticParams() {
  return BLOG_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const a = blogArticle(slug);
  if (!a) return { title: "Article introuvable" };
  return { title: `${a.title} — Blog Coligo`, description: a.excerpt };
}

export default async function BlogArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = blogArticle(slug);
  if (!article) notFound();

  const flags = await getFeatureFlags();
  if (article.requiresFlag && !isVisible(flags[article.requiresFlag])) {
    notFound();
  }

  const coverSrc = CATEGORY_IMAGES[article.coverKey];
  const cover = coverSrc
    ? (cldUrl(coverSrc, {
        width: 1600,
        height: 680,
        crop: "fill",
        gravity: "auto",
      }) ?? coverSrc)
    : null;

  // Suggestions : les 2 autres articles les plus récents (visibles).
  const others = BLOG_ARTICLES.filter(
    (a) =>
      a.slug !== article.slug &&
      (!a.requiresFlag || isVisible(flags[a.requiresFlag]))
  )
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 2);

  return (
    <main className="bg-surface-2 min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Link
          href="/blog"
          className="text-muted hover:text-foreground mb-6 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" /> Tous les articles
        </Link>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="bg-primary-50 text-primary-700 rounded-full px-2.5 py-0.5 text-[11px] font-bold">
            {article.category}
          </span>
          <span className="text-subtle text-xs">
            {blogDateLabel(article.publishedAt)}
          </span>
          <span className="text-subtle inline-flex items-center gap-0.5 text-xs">
            <Clock3 className="size-3" />
            {article.readMinutes} min de lecture
          </span>
        </div>

        <h1 className="text-foreground mt-3 text-2xl leading-tight font-black tracking-tight text-balance lg:text-3xl">
          {article.title}
        </h1>
        <p className="text-muted mt-3 text-[15px] leading-relaxed">
          {article.excerpt}
        </p>

        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={article.coverAlt}
            loading="eager"
            decoding="async"
            className="mt-6 aspect-[21/9] w-full rounded-[20px] object-cover"
          />
        )}

        {/* Corps de l'article */}
        <article className="mt-8 space-y-7">
          {article.body.map((section, i) => (
            <section key={i}>
              {section.heading && (
                <h2 className="text-foreground text-lg font-bold tracking-tight">
                  {section.heading}
                </h2>
              )}
              <div className="mt-2 space-y-3">
                {section.paragraphs.map((p, j) => (
                  <p
                    key={j}
                    className="text-foreground/85 text-[15px] leading-[1.75]"
                  >
                    {p}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </article>

        {/* CTA doux vers la marketplace */}
        <div className="cg-brand-gradient mt-10 rounded-[20px] p-6 text-white">
          <p className="text-lg font-bold">
            Vos commerces de quartier vous attendent.
          </p>
          <p className="mt-1 text-sm text-white/85">
            Commandez à l&apos;avance, récupérez sans attendre — c&apos;est
            gratuit et ça prend deux minutes.
          </p>
          <Link
            href="/"
            className="text-primary-700 mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-bold"
          >
            Découvrir la marketplace
            <ArrowRight className="size-4 rtl:-scale-x-100" />
          </Link>
        </div>

        {/* À lire ensuite */}
        {others.length > 0 && (
          <section className="mt-10">
            <h2 className="text-foreground text-lg font-bold">
              À lire ensuite
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {others.map((a) => (
                <Link
                  key={a.slug}
                  href={`/blog/${a.slug}`}
                  className="border-border bg-surface hover:bg-surface-2 block rounded-[16px] border p-4 transition-colors"
                >
                  <span className="text-primary-700 text-[11px] font-bold">
                    {a.category}
                  </span>
                  <p className="text-foreground mt-1 text-sm leading-snug font-semibold">
                    {a.title}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
