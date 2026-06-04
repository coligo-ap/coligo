import Link from "next/link";
import { Clock, Star, Tag } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { isOpenNow, nowInAlgiers } from "@/lib/merchant/opening-hours";
import { WILAYAS } from "@/lib/config/wilayas";
import { cldUrl } from "@/lib/images/cloudinary";
import { categoryImageFor } from "@/lib/images/category-images";
import { FavoriteHeart } from "@/components/customer/favorite-heart";
import type { PublicMerchant, PromoLabel } from "@/lib/data/merchants-public";

type Props = {
  merchant: PublicMerchant;
  /** Affiche un badge promo si le commerce a une promotion active. */
  hasPromo?: boolean;
  /** Détail de la meilleure promo active (− %, code, offre) — mis en avant. */
  promo?: PromoLabel | null;
  /** Distance client → commerce (km) si la position client est connue. */
  distanceKm?: number | null;
  /** Le client a-t-il déjà ce commerce en favori ? (état initial du cœur) */
  initialFavorite?: boolean;
  /** Client connecté — sinon le cœur redirige vers la connexion. */
  isAuth?: boolean;
  /** Rafraîchir la route après toggle (ex. page /favoris). */
  refreshOnToggle?: boolean;
};

/**
 * Carte commerce style Uber Eats : grande image de couverture, badge Ouvert +
 * cœur favori + ETA sur l'image, puis nom + note, ligne d'infos (frais /
 * distance / ville) et tags de mode. Refonte visuelle — on garde les mêmes
 * données (`PublicMerchant`) et la même navigation (`/m/[slug]`).
 */
export function MerchantCard({
  merchant,
  hasPromo,
  promo,
  distanceKm,
  initialFavorite = false,
  isAuth = false,
  refreshOnToggle = false,
}: Props) {
  const showPromo =
    promo ?? (hasPromo ? { text: "Promo", kind: "discount" as const } : null);
  const open = isOpenNow(merchant.opening_hours, nowInAlgiers());
  const wilayaName = merchant.wilaya_code
    ? WILAYAS.find((w) => w.code === merchant.wilaya_code)?.name
    : null;
  const cityLabel = merchant.commune || wilayaName || null;

  const coverSrc =
    merchant.cover_url ?? categoryImageFor(merchant.category) ?? null;
  const coverOptimized = cldUrl(coverSrc, {
    width: 640,
    height: 320,
    crop: "fill",
    gravity: "auto",
  });

  const distLabel =
    distanceKm != null && distanceKm >= 0
      ? `${distanceKm.toFixed(1).replace(".", ",")} km`
      : null;

  return (
    <Link
      href={`/m/${merchant.slug}`}
      // `isolate` = nouveau contexte d'empilement : les badges (z-20) restent
      // CONFINÉS dans la carte et ne passent plus AU-DESSUS du header / de la
      // barre de recherche sticky quand on scrolle.
      className={cn(
        "group isolate block active:scale-[0.99]",
        !open && "opacity-90"
      )}
    >
      {/* ─── Image de couverture + overlays ─── */}
      <div className="bg-surface-2 relative h-[158px] overflow-hidden rounded-[14px] shadow-sm">
        {coverOptimized ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverOptimized}
            alt={merchant.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="from-primary-100 to-primary-50 text-primary-700/70 flex h-full w-full items-center justify-center bg-gradient-to-br text-4xl font-bold">
            {merchant.name.charAt(0)}
          </div>
        )}
        {/* dégradé pour la lisibilité des badges */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/25"
        />

        {/* badge Ouvert / Fermé (haut-gauche) */}
        <span className="text-foreground absolute top-2.5 left-2.5 z-20 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1.5 text-[11px] font-extrabold shadow-sm backdrop-blur">
          <span
            className={cn(
              "size-[5px] rounded-full",
              open ? "animate-pulse bg-[var(--color-success-600)]" : "bg-subtle"
            )}
          />
          {open ? "Ouvert" : "Fermé"}
        </span>

        {/* cœur favori (haut-droite) */}
        <FavoriteHeart
          merchantId={merchant.id}
          initialFavorite={initialFavorite}
          isAuth={isAuth}
          refreshOnToggle={refreshOnToggle}
          className="absolute top-2.5 right-2.5 z-20"
        />

        {/* promo (bas-gauche, vert) */}
        {showPromo && (
          <span className="bg-success-600 absolute bottom-2.5 left-2.5 z-20 inline-flex items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[12px] font-extrabold text-white shadow-md">
            <Tag className="size-3" />
            {showPromo.text}
          </span>
        )}

        {/* ETA (bas-droite) */}
        {merchant.prep_time_min > 0 && (
          <span className="text-foreground absolute right-2.5 bottom-2.5 z-20 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1.5 text-[11.5px] font-extrabold shadow-sm backdrop-blur">
            <Clock className="size-3" />
            {merchant.prep_time_min} min
          </span>
        )}
      </div>

      {/* ─── Infos sous l'image ─── */}
      <div className="px-0.5 pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-foreground line-clamp-1 text-[17px] font-extrabold tracking-[-0.3px]">
            {merchant.name}
          </h3>
          {merchant.rating_count > 0 ? (
            <span className="bg-surface-2 text-foreground inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold">
              <Star className="size-3 fill-current" />
              {merchant.rating_avg.toFixed(1)}
            </span>
          ) : (
            <span className="bg-primary-50 text-primary-700 inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-bold">
              Nouveau
            </span>
          )}
        </div>

        {/* ligne d'infos : frais · distance · ville/min */}
        <div className="text-muted mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-semibold">
          <span className="text-success-700 font-bold">Retrait gratuit</span>
          {distLabel && (
            <>
              <Dot />
              <span>{distLabel}</span>
            </>
          )}
          {cityLabel && (
            <>
              <Dot />
              <span>{cityLabel}</span>
            </>
          )}
          {merchant.min_order_da > 0 && (
            <>
              <Dot />
              <span>Min {formatDA(merchant.min_order_da)}</span>
            </>
          )}
        </div>

        {/* tags de mode */}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {merchant.delivery_enabled && <Mode tone="deliv">🛵 Livraison</Mode>}
          {merchant.express_enabled && <Mode>⚡ Express</Mode>}
          <Mode>📍 Retrait</Mode>
        </div>
      </div>
    </Link>
  );
}

function Dot() {
  return <span className="bg-subtle size-[3px] rounded-full" aria-hidden />;
}

function Mode({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "deliv";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-[11px] font-bold",
        tone === "deliv"
          ? "bg-primary-50 text-primary-700"
          : "bg-surface-2 text-muted"
      )}
    >
      {children}
    </span>
  );
}
