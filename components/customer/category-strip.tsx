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
  Pill,
  Pizza,
  ShoppingBasket,
  Sprout,
  Wheat,
  type LucideIcon,
} from "lucide-react";

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

export function CategoryStrip({
  categories,
}: {
  categories: { name: string; count: number }[];
}) {
  if (categories.length === 0) return null;
  return (
    <div className="-mx-4 [scrollbar-width:none] overflow-x-auto px-4 lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max gap-3 pb-2 lg:min-w-0 lg:flex-wrap">
        {categories.map((c) => {
          const Icon = iconFor(c.name);
          return (
            <Link
              key={c.name}
              href={`/search?category=${encodeURIComponent(c.name)}`}
              className="group hover:border-primary-300 hover:bg-primary-50 border-border bg-surface flex w-20 shrink-0 flex-col items-center gap-1.5 rounded-[14px] border p-2.5 text-center transition-colors lg:w-24"
            >
              <span className="bg-primary-50 group-hover:bg-primary-100 text-primary-700 flex size-11 items-center justify-center rounded-full lg:size-12">
                <Icon className="size-5" />
              </span>
              <span className="text-foreground line-clamp-2 text-[11px] leading-tight font-medium">
                {c.name}
              </span>
              <span className="text-subtle text-[10px]">
                {c.count} commerce{c.count > 1 ? "s" : ""}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
