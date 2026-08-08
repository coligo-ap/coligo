import Link from "next/link";
import { ArrowLeft, ArrowRight, Clock3 } from "lucide-react";
import { getFeatureFlags, isVisible } from "@/lib/data/feature-flags";
import { BLOG_ARTICLES, blogDateLabel } from "@/lib/config/blog";
import { CATEGORY_IMAGES } from "@/lib/images/category-images";
import { cldUrl } from "@/lib/images/cloudinary";

export const metadata = {
  title: "Le blog Coligo — commerce de proximité, guides et coulisses",
  description:
    "Guides pratiques, conseils commerçants et coulisses de la plateforme : le blog officiel de Coligo, la marketplace algérienne du commerce de proximité.",
};

// =============================================================================
// /blog — liste des articles (source unique lib/config/blog.ts). Les articles
// liés à un service masqué par le super-admin sont filtrés (même logique que
// les CGU). Le plus récent est mis en avant, le reste en grille.
// =============================================================================

export default async function BlogPage() {
  const flags = await getFeatureFlags();
  const visible = BLOG_ARTICLES.filter(
    (a) => !a.requiresFlag || isVisible(flags[a.requiresFlag])
  ).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  const [featured, ...rest] = visible;

  return (
    <main className="bg-surface-2 min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Link
          href="/"
          className="text-muted hover:text-foreground mb-6 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" /> Retour
        </Link>

        <h1 className="text-foreground text-2xl font-bold tracking-tight">
          Le blog Coligo
        </h1>
        <p className="text-muted mt-1 text-sm">
          Guides pratiques, conseils pour les commerçants et coulisses de la
          plateforme — par l&apos;équipe Coligo.
        </p>

        {/* ───── À LA UNE ───── */}
        {featured && (
          <Link
            href={`/blog/${featured.slug}`}
            className="group border-border bg-surface mt-6 block overflow-hidden rounded-xl border shadow-sm transition-shadow hover:shadow-md"
          >
            <Cover
              coverKey={featured.coverKey}
              alt={featured.coverAlt}
              width={1600}
              height={800}
              className="aspect-[2/1] w-full object-cover"
              eager
            />
            <div className="p-5 lg:p-6">
              <Meta
                category={featured.category}
                date={featured.publishedAt}
                minutes={featured.readMinutes}
              />
              <h2 className="text-foreground mt-2 text-xl leading-snug font-bold tracking-tight text-balance lg:text-2xl">
                {featured.title}
              </h2>
              <p className="text-muted mt-2 text-sm leading-relaxed">
                {featured.excerpt}
              </p>
              <span className="text-primary-700 mt-3 inline-flex items-center gap-1 text-sm font-semibold">
                Lire l&apos;article
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" />
              </span>
            </div>
          </Link>
        )}

        {/* ───── LES AUTRES ───── */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {rest.map((a) => (
            <Link
              key={a.slug}
              href={`/blog/${a.slug}`}
              className="group border-border bg-surface rounded-sheet-lg block overflow-hidden border shadow-sm transition-shadow hover:shadow-md"
            >
              <Cover
                coverKey={a.coverKey}
                alt={a.coverAlt}
                width={800}
                height={450}
                className="aspect-[16/9] w-full object-cover"
              />
              <div className="p-4">
                <Meta
                  category={a.category}
                  date={a.publishedAt}
                  minutes={a.readMinutes}
                />
                <h2 className="text-foreground text-title-sm mt-1.5 leading-snug font-bold text-balance">
                  {a.title}
                </h2>
                <p className="text-muted text-body-sm mt-1.5 line-clamp-2 leading-relaxed">
                  {a.excerpt}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}

/** Photo de couverture optimisée (Cloudinary Fetch au ratio d'affichage —
 *  jamais de zoom navigateur, jamais d'upscale). */
function Cover({
  coverKey,
  alt,
  width,
  height,
  className,
  eager = false,
}: {
  coverKey: string;
  alt: string;
  width: number;
  height: number;
  className: string;
  eager?: boolean;
}) {
  const src = CATEGORY_IMAGES[coverKey];
  if (!src) return null;
  const url =
    cldUrl(src, { width, height, crop: "fill", gravity: "auto" }) ?? src;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={className}
    />
  );
}

/** Ligne méta : catégorie (chip) · date · temps de lecture. */
function Meta({
  category,
  date,
  minutes,
}: {
  category: string;
  date: string;
  minutes: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="bg-primary-50 text-primary-700 text-caption rounded-full px-2 py-0.5 font-bold">
        {category}
      </span>
      <span className="text-subtle text-caption">{blogDateLabel(date)}</span>
      <span className="text-subtle text-caption inline-flex items-center gap-0.5">
        <Clock3 className="size-3" />
        {minutes} min
      </span>
    </div>
  );
}
