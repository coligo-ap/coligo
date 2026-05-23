import Link from "next/link";
import { MapPin, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatDA } from "@/lib/utils";
import { isOpenNow } from "@/lib/merchant/opening-hours";
import { WILAYAS } from "@/lib/config/wilayas";
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

  return (
    <Link
      href={`/m/${merchant.slug}`}
      className={cn(
        "group border-border bg-surface relative block overflow-hidden rounded-[16px] border shadow-sm transition-shadow hover:shadow-md",
        !open && "opacity-95"
      )}
    >
      {/* Cover */}
      <div className="bg-surface-2 relative aspect-[16/9] w-full overflow-hidden">
        {merchant.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={merchant.cover_url}
            alt={merchant.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="from-primary-500/10 via-primary-400/5 to-surface-2 absolute inset-0 bg-gradient-to-br" />
        )}
        {/* Logo overlay */}
        {merchant.logo_url && (
          <div className="border-border absolute right-3 -bottom-6 size-12 overflow-hidden rounded-full border-2 bg-white shadow">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={merchant.logo_url}
              alt=""
              className="h-full w-full object-cover"
            />
          </div>
        )}
        {/* Open/Closed badge */}
        <span
          className={cn(
            "absolute top-2 left-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold backdrop-blur",
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
      </div>

      {/* Body */}
      <div className="space-y-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-foreground line-clamp-1 text-sm font-semibold">
            {merchant.name}
          </h3>
          {cashbackPct && cashbackPct > 0 && (
            <Badge tone="primary">{cashbackPct} % cashback</Badge>
          )}
        </div>

        {merchant.category && (
          <p className="text-muted line-clamp-1 text-xs">{merchant.category}</p>
        )}

        <div className="text-subtle flex items-center gap-2 text-[11px]">
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
