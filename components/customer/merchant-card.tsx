import Link from "next/link";
import { MapPin, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ImageWithOverlay } from "@/components/ui/image-with-overlay";
import { cn, formatDA } from "@/lib/utils";
import { isOpenNow } from "@/lib/merchant/opening-hours";
import { WILAYAS } from "@/lib/config/wilayas";
import { cldUrl } from "@/lib/images/cloudinary";
import { categoryImageFor } from "@/lib/images/category-images";
import type { PublicMerchant } from "@/lib/data/merchants-public";

type Props = {
  merchant: PublicMerchant;
  /** Pourcentage de cashback (entier déjà arrondi) — null si pas affiché. */
  cashbackPct?: number | null;
};

export function MerchantCard({ merchant, cashbackPct }: Props) {
  // `isOpenNow` est calculé à la VOLÉE depuis opening_hours (jamais stocké).
  const open = isOpenNow(merchant.opening_hours);
  const wilayaName = merchant.wilaya_code
    ? WILAYAS.find((w) => w.code === merchant.wilaya_code)?.name
    : null;
  // Fallback : si pas de cover, on prend une image illustrative de la catégorie.
  const coverSrc =
    merchant.cover_url ?? categoryImageFor(merchant.category) ?? null;
  const logoOptimized = cldUrl(merchant.logo_url, {
    width: 80,
    height: 80,
    crop: "fill",
    gravity: "auto",
  });

  return (
    <Link
      href={`/m/${merchant.slug}`}
      className={cn(
        "group border-border bg-surface relative block overflow-hidden rounded-[16px] border shadow-sm transition-shadow hover:shadow-md",
        !open && "opacity-95"
      )}
    >
      <div className="relative">
        <ImageWithOverlay
          src={coverSrc}
          alt={merchant.name}
          variant="card"
          imgClassName="transition-transform duration-300 group-hover:scale-[1.02]"
          placeholder={
            <span className="text-primary-700/70 text-2xl font-bold">
              {merchant.name.charAt(0)}
            </span>
          }
        >
          {/* Texte superposé sur la zone sombre du dégradé. */}
          <h3 className="line-clamp-1 text-base leading-tight font-bold drop-shadow-sm">
            {merchant.name}
          </h3>
          {merchant.category && (
            <p className="line-clamp-1 text-xs text-white/85">
              {merchant.category}
            </p>
          )}
        </ImageWithOverlay>

        {/* Open/Closed badge — au-dessus de l'overlay. */}
        <span
          className={cn(
            "absolute top-2 left-2 z-20 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold backdrop-blur",
            open
              ? "bg-success-500/95 text-white"
              : "bg-foreground/80 text-white"
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              open ? "bg-white" : "bg-white/70"
            )}
          />
          {open ? "Ouvert" : "Fermé"}
        </span>

        {cashbackPct && cashbackPct > 0 && (
          <Badge
            tone="primary"
            className="absolute top-2 right-2 z-20 shadow-sm"
          >
            {cashbackPct} % cashback
          </Badge>
        )}
      </div>

      {/* Body — méta secondaire (adresse, minimum) sous l'image. */}
      <div className="relative space-y-1 p-3">
        {logoOptimized && (
          <div className="absolute -top-6 right-3 size-12 overflow-hidden rounded-full border-2 border-white bg-white shadow-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoOptimized}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="text-subtle flex flex-wrap items-center gap-x-2 gap-y-1 pr-14 text-[11px]">
          {(merchant.commune || wilayaName) && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" />
              {[merchant.commune, wilayaName].filter(Boolean).join(", ")}
            </span>
          )}
          {merchant.min_order_da > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Wallet className="size-3" />
                Min {formatDA(merchant.min_order_da)}
              </span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
