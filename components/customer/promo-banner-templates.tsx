"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BannerProduct, PromoBanner } from "@/lib/data/promo-banners";
import { resolveModel } from "@/lib/data/promo-banner-models";

// =============================================================================
// Templates de bannière promo — carte LARGE à ratio FIXE 64/26 (même hauteur
// partout), fondu de marque + illustration 3D auto-hébergée (public/promo/*.png)
// OU bande de PRODUITS concernés. Modèle/palette/produits pilotés par le
// super-admin (mig 0391), avec repli AUTO selon le type de promo (Lot 1).
//
// Le clic (détails, MerchantOfferSheet) reste géré par le carrousel — ici on ne
// rend QUE le visuel. Rendu sous un arbre « use client » → les nombres sont
// groupés à la main (jamais Intl) pour rester SSR-safe.
// =============================================================================

const grp = (n: number) =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** Styles d'animation injectés UNE fois (évite une dépendance globale). */
export function PromoStyles() {
  return (
    <style>{`
      @keyframes promoBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
      @keyframes promoRide{0%,100%{transform:translateY(0)}30%{transform:translateY(-3px)}60%{transform:translateY(-1px)}}
      @keyframes promoBlink{50%{opacity:.25}}
      .promo-bob{animation:promoBob 4s ease-in-out infinite}
      .promo-ride{animation:promoRide 2.4s ease-in-out infinite}
      .promo-blink{animation:promoBlink 1s steps(1) infinite}
      @media (prefers-reduced-motion:reduce){.promo-bob,.promo-ride,.promo-blink{animation:none}}
    `}</style>
  );
}

/** Prix promo d'un produit selon l'offre (percent / amount) — sinon null. */
function promoPrice(price: number, offer: PromoBanner["offer"]): number | null {
  if (!offer || offer.discount_value == null) return null;
  if (offer.discount_kind === "percent")
    return Math.max(0, Math.round(price * (1 - offer.discount_value / 100)));
  if (offer.discount_kind === "amount")
    return Math.max(0, price - offer.discount_value);
  return null;
}

/** Mini-carte produit (affichage SEUL — le clic ouvre le détail de la card). */
function MiniProduct({
  p,
  offer,
}: {
  p: BannerProduct;
  offer: PromoBanner["offer"];
}) {
  const promo = promoPrice(p.price_da, offer);
  return (
    <div className="flex w-[62px] shrink-0 flex-col overflow-hidden rounded-[7px] border border-black/10 bg-white shadow-[0_6px_12px_-7px_rgba(0,0,0,.4)]">
      <div className="grid h-9 place-items-center overflow-hidden bg-neutral-100">
        {p.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.image_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="px-1 pt-0.5 pb-1">
        <div className="truncate text-[7px] font-semibold text-neutral-600">
          {p.name_fr}
        </div>
        <div className="font-display text-[9.5px] leading-none font-extrabold text-[#C81428]">
          {grp(promo ?? p.price_da)}
          {promo != null && (
            <span className="ms-0.5 text-[6.5px] font-medium text-neutral-400 line-through">
              {grp(p.price_da)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Compte à rebours (vente flash) — monté côté client uniquement (0 mismatch). */
function Countdown({ endsAt }: { endsAt: string }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () =>
      setLeft(Math.max(0, new Date(endsAt).getTime() - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  if (left == null || left <= 0) return null;
  const s = Math.floor(left / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const cell =
    "rounded-md border border-amber-300/60 bg-white/15 px-1.5 py-0.5 tabular-nums";
  return (
    <div className="mt-2 flex items-center gap-1 font-mono text-[13px] font-extrabold text-white">
      <span className={cell}>{pad(Math.floor(s / 3600))}</span>
      <span className="promo-blink text-amber-300">:</span>
      <span className={cell}>{pad(Math.floor((s % 3600) / 60))}</span>
      <span className="promo-blink text-amber-300">:</span>
      <span className={cell}>{pad(s % 60)}</span>
    </div>
  );
}

/** Carte visuelle d'une bannière (SANS le wrapper de clic). */
export function BannerCard({ banner }: { banner: PromoBanner }) {
  const { model, grad } = resolveModel(banner);
  const fit = banner.image_fit ?? "overlay";
  const hasImg = !!banner.image_url;
  // Image PLEINE (cover) = la photo EST le héros → pas d'illustration ni de
  // produits par-dessus.
  const coverImg = hasImg && fit === "cover";

  const products = banner.offer?.products ?? [];
  const showProducts = banner.show_products && products.length > 0 && !coverImg;
  const art = model.art !== "none" ? model.art : null;
  const showArt = !!art && !coverImg && !showProducts;

  return (
    <article
      className="relative aspect-[64/26] w-full overflow-hidden rounded-[16px] shadow-md"
      style={{ background: grad }}
    >
      {/* Image de fond optionnelle (fondu de marque + image derrière). */}
      {hasImg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={banner.image_url!}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            "absolute inset-0 h-full w-full",
            fit === "cover"
              ? "object-cover"
              : fit === "contain"
                ? "object-contain"
                : "object-cover mix-blend-overlay"
          )}
          style={
            fit === "overlay"
              ? { opacity: (banner.overlay_opacity ?? 30) / 100 }
              : undefined
          }
        />
      )}

      {/* Voile GAUCHE : texte lisible sur n'importe quel dégradé / image. */}
      <div
        className="absolute inset-0"
        style={{
          background: coverImg
            ? "linear-gradient(90deg, rgba(0,0,0,.62), rgba(0,0,0,.15) 55%, transparent 72%)"
            : "linear-gradient(90deg, rgba(10,4,30,.34), rgba(10,4,30,.06) 52%, transparent 70%)",
        }}
      />

      {/* Produits concernés (bande, affichage seul) OU illustration 3D. */}
      {showProducts ? (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-[5] flex w-[46%] items-center gap-1.5 overflow-hidden pe-2.5">
          {products.slice(0, 3).map((p) => (
            <MiniProduct key={p.id} p={p} offer={banner.offer} />
          ))}
        </div>
      ) : showArt ? (
        <div className="pointer-events-none absolute inset-y-0 right-[3%] z-[5] flex w-[40%] items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/promo/${art}.png`}
            alt=""
            loading="lazy"
            decoding="async"
            className={cn(
              "max-h-[86%] w-auto max-w-full object-contain drop-shadow-[0_12px_16px_rgba(20,10,50,.42)]",
              model.ride ? "promo-ride" : "promo-bob"
            )}
          />
        </div>
      ) : null}

      {/* Texte à gauche. La hauteur de la carte est FIXE (ratio 64/26) : on
          borne le bloc et on resserre le sous-titre quand un compte à rebours
          vient s'ajouter, sinon le texte déborde sur les cartes étroites. */}
      <div className="absolute inset-y-0 left-0 z-10 flex w-[62%] flex-col justify-center overflow-hidden px-5 text-white">
        <h3 className="font-display line-clamp-2 text-lg leading-tight font-bold sm:text-xl">
          {banner.title}
        </h3>
        {banner.subtitle && (
          <p
            className={cn(
              "mt-1 text-sm opacity-90",
              model.countdown && banner.offer?.ends_at
                ? "line-clamp-1"
                : "line-clamp-2"
            )}
          >
            {banner.subtitle}
          </p>
        )}
        {model.countdown && banner.offer?.ends_at && (
          <Countdown endsAt={banner.offer.ends_at} />
        )}
        {banner.cta_label && (
          <span className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs font-semibold backdrop-blur transition-colors group-hover:bg-white/30">
            {banner.cta_label}
            <ArrowRight className="size-3.5 rtl:-scale-x-100" />
          </span>
        )}
      </div>
    </article>
  );
}
