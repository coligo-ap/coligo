import { cn } from "@/lib/utils";
import { cldSrcSet, cldUrl } from "@/lib/images/cloudinary";

// =============================================================================
// ImageWithOverlay — image optimisée Cloudinary + overlay dégradé sombre
// =============================================================================
// L'overlay est le DÉGRADÉ VALIDÉ du prompt 15 (sombre bas → transparent haut),
// appliqué via la classe utilitaire `image-overlay-gradient` définie dans
// `app/globals.css`. Le contenu texte (titre, badges) se place via `children`
// et atterrit en BAS de l'image, sur la zone sombre lisible.
//
// Variantes :
//   - hero    : aspect 21:9 (desktop) → grand, type bannière fiche merchant.
//   - card    : aspect 16:9 → vignette carte (accueil, recherche).
//   - tile    : aspect 1:1  → tuile carrée (catégories).
//
// Fallback : si `src` est null/vide, affiche un dégradé violet doux avec un
// éventuel slot `placeholder` (initiale, icône, etc.).

type Variant = "hero" | "card" | "tile";

const ASPECT: Record<Variant, string> = {
  hero: "aspect-[21/9]",
  card: "aspect-[16/9]",
  tile: "aspect-square",
};

const DEFAULT_SIZES: Record<Variant, string> = {
  hero: "(min-width: 1024px) 1100px, 100vw",
  card: "(min-width: 1280px) 350px, (min-width: 640px) 50vw, 100vw",
  tile: "120px",
};

// Tailles servies en srcset (Cloudinary les générera à la volée).
const SRCSET_WIDTHS: Record<Variant, number[]> = {
  hero: [640, 960, 1280, 1600, 2000],
  card: [320, 480, 640, 800],
  tile: [120, 240, 360],
};

type Props = {
  src: string | null | undefined;
  alt: string;
  variant?: Variant;
  /** Force un autre aspect ratio (override de variant). Ex: "aspect-[3/1]". */
  aspectClassName?: string;
  /** Charge l'image immédiatement (LCP). Sinon lazy. */
  priority?: boolean;
  /** Désactive l'overlay (image décorative sans texte). */
  noOverlay?: boolean;
  /** Slot contenu superposé (titre, badges) — en bas par défaut. */
  children?: React.ReactNode;
  /** Slot rendu si `src` est absent (initiale, icône). */
  placeholder?: React.ReactNode;
  /** Classe sur le conteneur racine. */
  className?: string;
  /** Classe sur l'image elle-même (ex: scale au hover). */
  imgClassName?: string;
  /** Position du slot enfant. Default "bottom". */
  childrenPosition?: "bottom" | "center";
  /** `sizes` HTML — surcharge le défaut de la variante. */
  sizes?: string;
};

export function ImageWithOverlay({
  src,
  alt,
  variant = "card",
  aspectClassName,
  priority = false,
  noOverlay = false,
  children,
  placeholder,
  className,
  imgClassName,
  childrenPosition = "bottom",
  sizes,
}: Props) {
  const aspect = aspectClassName ?? ASPECT[variant];
  const optimizedSrc = cldUrl(src, { crop: "fill", gravity: "auto" });
  const srcSet = cldSrcSet(src, SRCSET_WIDTHS[variant], {
    crop: "fill",
    gravity: "auto",
  });

  return (
    <div
      className={cn(
        "bg-surface-2 relative w-full overflow-hidden",
        aspect,
        className
      )}
    >
      {optimizedSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={optimizedSrc}
          srcSet={srcSet}
          sizes={sizes ?? DEFAULT_SIZES[variant]}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          className={cn("h-full w-full object-cover", imgClassName)}
        />
      ) : (
        <div className="from-primary-500/20 via-primary-400/10 to-surface-2 absolute inset-0 flex items-center justify-center bg-gradient-to-br">
          {placeholder}
        </div>
      )}

      {!noOverlay && optimizedSrc && (
        <div
          aria-hidden
          className="image-overlay-gradient pointer-events-none absolute inset-0"
        />
      )}

      {children && (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 z-10 px-4 pb-4 lg:px-6 lg:pb-6",
            childrenPosition === "bottom"
              ? "bottom-0"
              : "top-1/2 -translate-y-1/2"
          )}
        >
          <div className="pointer-events-auto text-white">{children}</div>
        </div>
      )}
    </div>
  );
}
