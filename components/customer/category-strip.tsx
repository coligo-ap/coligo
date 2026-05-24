import Link from "next/link";
import {
  Beef,
  Cake,
  Carrot,
  CircleHelp,
  Coffee,
  Croissant,
  Fish,
  Flower2,
  IceCream2,
  LayoutGrid,
  Pill,
  Pizza,
  ShoppingBasket,
  Sprout,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { cldUrl } from "@/lib/images/cloudinary";
import {
  CATEGORY_IMAGES,
  categoryImageFor,
} from "@/lib/images/category-images";

const ICONS: { match: RegExp; icon: LucideIcon }[] = [
  { match: /boulang/i, icon: Croissant },
  { match: /p[âa]tisserie|gateau|gâteau/i, icon: Cake },
  { match: /caf[ée]|coffee|salon/i, icon: Coffee },
  { match: /super[éeè]?rette|épicerie|alimentation/i, icon: ShoppingBasket },
  { match: /boucherie|viande/i, icon: Beef },
  { match: /poisson|seafood/i, icon: Fish },
  { match: /fruit|primeur|l[ée]gume/i, icon: Carrot },
  { match: /pharma/i, icon: Pill },
  { match: /pizza|fast.?food|restaurant/i, icon: Pizza },
  { match: /glac|ice/i, icon: IceCream2 },
  { match: /fleur|florist/i, icon: Flower2 },
  { match: /bio|naturel/i, icon: Sprout },
  { match: /c[ée]r[ée]ale|grains?/i, icon: Wheat },
];

function iconFor(name: string): LucideIcon {
  return ICONS.find((c) => c.match.test(name))?.icon ?? CircleHelp;
}

// =============================================================================
// Catégories épinglées : toujours visibles, en tête, dans cet ordre.
// =============================================================================
// Les noms correspondent à la catégorie textuelle stockée sur les commerces
// (champ `merchants.category`). On fait un MATCH SOUPLE (regex iconFor) pour
// retrouver le compte réel : "Supérette", "supérette", "Superette" → 1 seul
// bucket prioritaire. Si zéro commerce de ce type → on affiche quand même la
// pastille (compte = 0) car la priorité produit l'exige.
// Le href doit utiliser le CODE catégorie tel qu'il est stocké en DB
// (voir `lib/config/categories.ts` — c'est ce que le merchant signup enregistre).
// Sinon `ilike '%X%'` côté serveur ne matche pas (accent-sensitive).
const PRIORITY: {
  label: string;
  matcher: RegExp;
  href: string;
  image: string | null;
}[] = [
  {
    label: "Supérettes",
    matcher: /super[éeè]?rette|épicerie|alimentation/i,
    href: "/?category=superette",
    image: CATEGORY_IMAGES.superette ?? null,
  },
  {
    label: "Boulangeries",
    matcher: /boulang/i,
    href: "/?category=boulangerie",
    image: CATEGORY_IMAGES.boulangerie ?? null,
  },
  {
    label: "Boucheries",
    matcher: /boucherie|viande/i,
    href: "/?category=boucherie",
    image: CATEGORY_IMAGES.boucherie ?? null,
  },
];

export function CategoryStrip({
  categories,
}: {
  categories: { name: string; count: number }[];
}) {
  // 1. Buckets prioritaires : on additionne les counts des catégories DB qui
  //    matchent la regex (pluralise les variantes orthographiques).
  const matchedIds = new Set<number>();
  const priorityCards = PRIORITY.map((p) => {
    let count = 0;
    categories.forEach((c, idx) => {
      if (p.matcher.test(c.name)) {
        count += c.count;
        matchedIds.add(idx);
      }
    });
    return { ...p, count };
  });

  // 2. Catégories non prioritaires (toutes les autres).
  const others = categories.filter((_, idx) => !matchedIds.has(idx));

  return (
    <div className="-mx-4 [scrollbar-width:none] overflow-x-auto px-4 lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max gap-3 pb-2 lg:min-w-0 lg:flex-wrap">
        {/* Tous les commerces — point d'entrée par défaut, en TÊTE */}
        <Tile
          href="/"
          icon={LayoutGrid}
          label="Tous"
          hint="Voir tout"
          highlight
        />

        {/* Prioritaires : Supérettes / Boulangeries / Boucheries */}
        {priorityCards.map((p) => (
          <Tile
            key={p.label}
            href={p.href}
            icon={iconFor(p.label)}
            image={p.image}
            label={p.label}
            hint={
              p.count > 0
                ? `${p.count} commerce${p.count > 1 ? "s" : ""}`
                : "Bientôt"
            }
            dimmed={p.count === 0}
          />
        ))}

        {/* Autres catégories existantes en DB */}
        {others.map((c) => (
          <Tile
            key={c.name}
            href={`/?category=${encodeURIComponent(c.name)}`}
            icon={iconFor(c.name)}
            image={categoryImageFor(c.name)}
            label={c.name}
            hint={`${c.count} commerce${c.count > 1 ? "s" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}

function Tile({
  href,
  icon: Icon,
  image,
  label,
  hint,
  highlight,
  dimmed,
}: {
  href: string;
  icon: LucideIcon;
  image?: string | null;
  label: string;
  hint: string;
  highlight?: boolean;
  dimmed?: boolean;
}) {
  // Image optimisée 96×96 (DPR géré par Cloudinary) — surclassée par une
  // pastille violet/icône si pas d'image disponible (ex. tuile "Tous").
  const optimizedImage = image
    ? cldUrl(image, { width: 96, height: 96, crop: "fill", gravity: "auto" })
    : null;

  return (
    <Link
      href={href}
      className={cn(
        "group flex w-20 shrink-0 flex-col items-center gap-1.5 rounded-[14px] border p-2.5 text-center transition-colors lg:w-24",
        highlight
          ? "border-primary-200 bg-primary-50 hover:border-primary-400 hover:bg-primary-100"
          : "border-border bg-surface hover:border-primary-300 hover:bg-primary-50",
        dimmed && "opacity-60"
      )}
    >
      <span
        className={cn(
          "relative flex size-11 items-center justify-center overflow-hidden rounded-full lg:size-12",
          highlight
            ? "bg-primary-600 text-white"
            : "bg-primary-50 text-primary-700 group-hover:bg-primary-100"
        )}
      >
        {optimizedImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={optimizedImage}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
            {/* Léger voile pour homogénéité visuelle + lisibilité hover. */}
            <span className="absolute inset-0 bg-black/15 transition-opacity group-hover:bg-black/0" />
          </>
        ) : (
          <Icon className="size-5" />
        )}
      </span>
      <span className="text-foreground line-clamp-2 text-[11px] leading-tight font-medium">
        {label}
      </span>
      <span className="text-subtle text-[10px]">{hint}</span>
    </Link>
  );
}
