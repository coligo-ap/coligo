"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PromoBanner } from "@/lib/data/promo-banners";

// =============================================================================
// Templates de bannière promo — Lot 1 (rendu client, AUTO-mappé par type de
// promo, ZÉRO migration). Portage des modèles de « coligo-collection-finale »
// (ratio LARGE fixe 64/26 → même hauteur partout), fondus de marque + une
// illustration 3D auto-hébergée par type (public/promo/*.png, extraites du
// HTML de référence → licences maison, jamais de CDN externe).
//
// Le clic (détails, MerchantOfferSheet) reste géré par le carrousel — ici on ne
// rend QUE le visuel de la carte. Le super-admin pourra surcharger modèle /
// couleurs / image / produits au Lot 2.
// =============================================================================

/** Dégradés doux repris de la maquette (fondus de marque). */
const GRAD = {
  deliv: "linear-gradient(120deg,#7C3AED,#9B5CF0 35%,#BE93F2 65%,#DCC5F8)",
  brand: "linear-gradient(120deg,#6D2FD8,#8B4BE8 35%,#C86BD9 65%,#F0619A)",
  mint: "linear-gradient(120deg,#3F8D6C,#6AB08D 40%,#9FD3B6 75%,#5FA383)",
  sky: "linear-gradient(120deg,#8B93E8,#A6B4EE 30%,#BCD0F2 55%,#8E9AE4)",
  dusk: "linear-gradient(120deg,#1E3A5C,#33567F 30%,#6D7FA6 55%,#C9A24E 88%,#E4BE6A)",
  slate: "linear-gradient(120deg,#16161e,#2a2340 60%,#3a2c5e)",
} as const;

type Art =
  | "scooter"
  | "percent"
  | "megaphone"
  | "confetti"
  | "emoji-stars"
  | "cashback";

type Tpl = { grad: string; art?: Art; ride?: boolean; countdown?: boolean };

/** Modèle AUTOMATIQUE selon le type de promo (offre) ou l'accent (éditoriale). */
function templateFor(banner: PromoBanner): Tpl {
  switch (banner.offer?.type) {
    case "free_delivery":
      return { grad: GRAD.deliv, art: "scooter", ride: true };
    case "product_discount":
      return { grad: GRAD.brand, art: "percent" };
    case "promo_code":
      return { grad: GRAD.brand, art: "megaphone" };
    case "free_gift":
      return { grad: GRAD.brand, art: "confetti" };
    case "quantity_offer":
      return { grad: GRAD.sky, art: "emoji-stars" };
    case "anti_gaspillage":
      return { grad: GRAD.mint, art: "emoji-stars" };
    case "flash_sale":
      return { grad: GRAD.dusk, art: "confetti", countdown: true };
  }
  // Bannière éditoriale (sans offre) : mappée sur l'accent existant.
  const byAccent: Record<PromoBanner["accent"], Tpl> = {
    violet: { grad: GRAD.brand, art: "megaphone" },
    coral: { grad: GRAD.brand, art: "confetti" },
    mint: { grad: GRAD.mint, art: "emoji-stars" },
    amber: { grad: GRAD.dusk, art: "cashback" },
    dark: { grad: GRAD.slate, art: "cashback" },
  };
  return byAccent[banner.accent] ?? { grad: GRAD.brand };
}

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
  const tpl = templateFor(banner);
  const fit = banner.image_fit ?? "overlay";
  const hasImg = !!banner.image_url;
  // Image PLEINE (cover) = la photo EST le héros → on masque l'illustration 3D
  // pour ne pas surcharger. Sinon : dégradé de marque + illustration.
  const coverImg = hasImg && fit === "cover";
  const showArt = !!tpl.art && !coverImg;

  return (
    <article
      className="relative aspect-[64/26] w-full overflow-hidden rounded-[16px] shadow-md"
      style={{ background: tpl.grad }}
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

      {/* Voile GAUCHE : garantit un texte lisible sur n'importe quel dégradé /
          image (jamais de texte pâle illisible). */}
      <div
        className="absolute inset-0"
        style={{
          background: coverImg
            ? "linear-gradient(90deg, rgba(0,0,0,.62), rgba(0,0,0,.15) 55%, transparent 72%)"
            : "linear-gradient(90deg, rgba(10,4,30,.34), rgba(10,4,30,.06) 52%, transparent 70%)",
        }}
      />

      {/* Illustration 3D à droite. */}
      {showArt && (
        <div className="pointer-events-none absolute inset-y-0 right-[3%] z-[5] flex w-[40%] items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/promo/${tpl.art}.png`}
            alt=""
            loading="lazy"
            decoding="async"
            className={cn(
              "max-h-[86%] w-auto max-w-full object-contain drop-shadow-[0_12px_16px_rgba(20,10,50,.42)]",
              tpl.ride ? "promo-ride" : "promo-bob"
            )}
          />
        </div>
      )}

      {/* Texte à gauche. */}
      <div className="absolute inset-y-0 left-0 z-10 flex w-[62%] flex-col justify-center px-5 text-white">
        <h3 className="font-display text-lg leading-tight font-bold sm:text-xl">
          {banner.title}
        </h3>
        {banner.subtitle && (
          <p className="mt-1 line-clamp-2 text-sm opacity-90">
            {banner.subtitle}
          </p>
        )}
        {tpl.countdown && banner.offer?.ends_at && (
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
