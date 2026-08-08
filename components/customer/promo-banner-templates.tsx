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

/**
 * Tailles de texte d'une bannière — calculées, jamais figées.
 *
 * La carte a une hauteur IMPOSÉE (ratio 64/26) : au-delà d'une certaine
 * longueur, un titre en taille fixe finit coupé ou sous l'illustration. On
 * choisit donc un palier selon le nombre de caractères ET la largeur de la
 * colonne de texte disponible, exprimé en `cqw` (1 cqw = 1 % de la largeur de
 * la CARTE) pour que tout suive la taille réelle du composant.
 *
 * `fallback` = classe Tailwind appliquée si le navigateur ne connaît pas les
 * unités de conteneur : la déclaration inline devient invalide et la classe
 * reprend la main (aucun écran sans texte).
 */
function bannerFontSizes(
  banner: PromoBanner,
  model: { countdown?: boolean },
  textWidth: string
) {
  // Caractères tenant sur une ligne, à la louche : plus la colonne est étroite,
  // plus le palier se déclenche tôt.
  const col = parseFloat(textWidth); // 52 / 56 / 84
  const title = banner.title ?? "";
  const sub = banner.subtitle ?? "";
  // Un compte à rebours mange une ligne entière → on resserre le titre.
  const budget = (model.countdown && banner.offer?.ends_at ? 0.8 : 1) * col;

  const long = title.length > budget * 0.62;
  const veryLong = title.length > budget * 0.95;

  const titleCq = veryLong ? 4.2 : long ? 5 : 5.9;
  const titleMax = veryLong ? 20 : long ? 24 : 28;
  const subLong = sub.length > budget * 1.1;

  return {
    title: {
      fontSize: `clamp(13px, ${titleCq}cqw, ${titleMax}px)`,
    },
    subtitle: {
      fontSize: `clamp(10.5px, ${subLong ? 3.1 : 3.6}cqw, ${subLong ? 13 : 15}px)`,
    },
    cta: { fontSize: "clamp(10px, 2.9cqw, 13px)" },
  };
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
    <div className="flex w-[62px] shrink-0 flex-col overflow-hidden rounded-[7px] border border-black/10 bg-white">
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
        <div className="font-display text-nano-lg leading-none font-extrabold text-[#C81428]">
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
    <div className="text-body-sm mt-2 flex items-center gap-1 font-mono font-extrabold text-white">
      <span className={cell}>{pad(Math.floor(s / 3600))}</span>
      <span className="promo-blink text-amber-300">:</span>
      <span className={cell}>{pad(Math.floor((s % 3600) / 60))}</span>
      <span className="promo-blink text-amber-300">:</span>
      <span className={cell}>{pad(s % 60)}</span>
    </div>
  );
}

/**
 * Carte visuelle d'une bannière (SANS le wrapper de clic).
 *
 * Le texte s'adapte TOUT SEUL — même carte à l'accueil et sur la fiche
 * commerçant, quelle que soit la largeur disponible :
 *   - taille en unités de conteneur (`cqw`) → elle suit la largeur RÉELLE de la
 *     carte, pas un point de rupture d'écran (classe Tailwind gardée en repli
 *     si le navigateur ignore les unités de conteneur) ;
 *   - palier selon la LONGUEUR du libellé → un titre long descend d'un cran
 *     plutôt que d'être coupé ;
 *   - la colonne de texte s'arrête AVANT l'illustration / la bande de produits
 *     (largeurs calculées ci-dessous) → plus jamais de texte passant dessous.
 */
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

  // Place réellement libre à gauche : la bande de produits occupe 46 % à
  // droite, l'illustration 40 % à partir de 57 %.
  const textWidth = showProducts ? "52%" : showArt ? "56%" : "84%";
  const fonts = bannerFontSizes(banner, model, textWidth);

  return (
    <article
      // Plus d'`aspect-ratio` FIGÉ : la carte garde la proportion 64/26 grâce
      // au gabarit ci-dessous, mais elle GRANDIT si le texte a besoin de place
      // — typiquement quand l'utilisateur a agrandi la police de son téléphone.
      // Avant, le titre était coupé en deux (bug vécu sur Galaxy S10E).
      className="@container relative flex w-full overflow-hidden rounded-lg"
      style={{ background: grad, containerType: "inline-size" }}
    >
      {/* Gabarit de proportion : `padding-top` en % se calcule sur la LARGEUR
          de la carte → hauteur = 26/64 de la largeur, sans occuper de place
          horizontale. C'est le PLANCHER de hauteur ; le texte peut dépasser. */}
      <div
        aria-hidden
        className="w-0 shrink-0"
        style={{ paddingTop: "40.625%" }}
      />
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
              "drop- max-h-[86%] w-auto max-w-full object-contain",
              model.ride ? "promo-ride" : "promo-bob"
            )}
          />
        </div>
      ) : null}

      {/* Texte à gauche. La colonne s'arrête AVANT l'illustration / les
          produits (largeur calculée), le bloc est borné en hauteur, et les
          tailles suivent la largeur réelle de la carte (cqw) → un titre long
          rétrécit au lieu de passer sous l'autocollant ou d'être coupé. */}
      <div
        className="relative z-10 flex shrink-0 flex-col justify-center px-4 text-white sm:px-5"
        style={{ width: textWidth }}
      >
        <h3
          className="font-display line-clamp-2 text-lg leading-tight font-bold text-balance"
          style={fonts.title}
        >
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
            style={fonts.subtitle}
          >
            {banner.subtitle}
          </p>
        )}
        {model.countdown && banner.offer?.ends_at && (
          <Countdown endsAt={banner.offer.ends_at} />
        )}
        {banner.cta_label && (
          <span
            className="mt-2.5 inline-flex w-fit max-w-full items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs font-semibold backdrop-blur transition-colors group-hover:bg-white/30"
            style={fonts.cta}
          >
            <span className="truncate">{banner.cta_label}</span>
            <ArrowRight className="size-3.5 shrink-0 rtl:-scale-x-100" />
          </span>
        )}
      </div>
    </article>
  );
}
