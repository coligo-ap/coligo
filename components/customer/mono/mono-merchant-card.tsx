import { Bike, Star } from "lucide-react";
import { cn } from "@/lib/utils";

// =============================================================================
// MonoMerchantCard — carte commerce du thème « bold minimalism ».
//
// Fond blanc, coins 20 px, liseré d'ombre à peine perceptible. Image 16:10 en
// haut, coins alignés sur ceux de la carte.
//
// Deux familles de badges, jamais mélangées :
//  - PROMO, empilés en haut à gauche : pilule --promo, texte --ink. C'est le
//    SEUL emploi du vert néon (jamais du texte, jamais une icône).
//  - SYSTÈME (Sponsorisé, Précommande), en bas à droite : pilule noire 70 %,
//    texte blanc — ils informent, ils ne vendent pas.
//
// ÉCHELLE relevée sur fastapp.dz à 393 px : carte 185 px (47 % de l'écran) en
// carrousel, image 185x116 (16:10), nom 15/700, méta 14/600, rayon 12-14 px,
// AUCUNE ombre. La première version (pleine largeur, nom 20 px) donnait des
// cartes énormes — c'est ce que le propriétaire a fait corriger.
//
// Le modèle de données reprend celui de `PublicMerchant` (nom, couverture,
// note, avis, catégorie, délai, frais) : brancher les vraies données revient à
// mapper, pas à réécrire.
// =============================================================================

export type MonoMerchant = {
  slug: string;
  name: string;
  cover: string;
  rating: number;
  reviews: number;
  category: string;
  /** Fourchette de livraison, déjà formatée (« 20-30 min »). */
  eta: string;
  /** Frais de livraison affichés (« 200 DA », « Gratuit »). */
  fee: string;
  /** Ancien tarif barré, s'il y a une remise en cours. */
  feeBefore?: string | null;
  /** Étiquettes promo empilées en haut à gauche. */
  promos?: string[];
  /** Étiquettes système (Sponsorisé, Précommande) en bas à droite. */
  systemBadges?: string[];
};

export function MonoMerchantCard({
  merchant: m,
  className,
  href,
}: {
  merchant: MonoMerchant;
  className?: string;
  /** Rend la carte cliquable (fiche boutique). */
  href?: string;
}) {
  const Tag = (href ? "a" : "article") as "a";
  return (
    <Tag
      href={href}
      className={cn(
        "block overflow-hidden rounded-[var(--radius-card)] bg-[var(--surface-card)] shadow-[var(--shadow-card)]",
        className
      )}
    >
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={m.cover}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          className="aspect-[16/10] w-full object-cover"
        />

        {(m.promos?.length ?? 0) > 0 && (
          <div className="absolute start-2 top-2 flex flex-col items-start gap-1.5">
            {m.promos!.map((p) => (
              <span
                key={p}
                className="text-label rounded-[var(--radius-pill)] bg-[var(--promo)] px-2.5 py-1 font-bold text-[var(--ink)]"
              >
                {p}
              </span>
            ))}
          </div>
        )}

        {(m.systemBadges?.length ?? 0) > 0 && (
          <div className="absolute end-2 bottom-2 flex flex-col items-end gap-1.5">
            {m.systemBadges!.map((b) => (
              <span
                key={b}
                className="text-label rounded-[var(--radius-pill)] bg-[var(--scrim)] px-2.5 py-1 font-bold text-[var(--surface-card)]"
              >
                {b}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="p-3">
        <h3 className="text-title-sm truncate leading-tight font-bold text-[var(--ink)]">
          {m.name}
        </h3>

        {/* Ligne méta : ★ note · (nb avis) · catégorie. */}
        <p className="text-body-lg mt-1 flex items-center gap-1 overflow-hidden font-semibold whitespace-nowrap text-[var(--ink)]">
          {/* Sans le moindre avis, on n'affiche PAS « 0.0 (0) » : un zéro se lit
              comme une mauvaise note alors qu'il n'y a simplement rien. */}
          {m.reviews > 0 && (
            <>
              <Star
                aria-hidden
                className="size-3.5 shrink-0 fill-[var(--rating)] text-[var(--rating)]"
              />
              {m.rating.toFixed(1)}
              <span className="text-[var(--ink-muted)]">({m.reviews})</span>
              <span aria-hidden className="text-[var(--ink-muted)]">
                ·
              </span>
            </>
          )}
          <span className="truncate">{m.category}</span>
        </p>

        {/* Ligne livraison : délai · vélo · prix (barré si remise). */}
        {/* 13 px ici (et pas 14) : à 168 px de carte, « 20-35 min · 600 DA »
            se faisait couper. Le point séparateur saute aussi. */}
        <p className="text-body-sm mt-0.5 flex items-center gap-1.5 overflow-hidden font-semibold whitespace-nowrap text-[var(--ink)]">
          {m.eta}
          <Bike aria-hidden className="size-3.5 shrink-0 text-[var(--brand)]" />
          <span className="font-bold">{m.fee}</span>
          {m.feeBefore && (
            <s className="font-medium text-[var(--ink-muted)]">{m.feeBefore}</s>
          )}
        </p>
      </div>
    </Tag>
  );
}
