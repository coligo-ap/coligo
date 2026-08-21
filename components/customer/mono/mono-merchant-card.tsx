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
}: {
  merchant: MonoMerchant;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "overflow-hidden rounded-[var(--radius-card)] bg-[var(--surface-card)] shadow-[var(--shadow-card)]",
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
          <div className="absolute start-3 top-3 flex flex-col items-start gap-2">
            {m.promos!.map((p) => (
              <span
                key={p}
                className="text-body-sm rounded-[var(--radius-pill)] bg-[var(--promo)] px-3 py-1 font-bold text-[var(--ink)]"
              >
                {p}
              </span>
            ))}
          </div>
        )}

        {(m.systemBadges?.length ?? 0) > 0 && (
          <div className="absolute end-3 bottom-3 flex flex-wrap justify-end gap-2">
            {m.systemBadges!.map((b) => (
              <span
                key={b}
                className="text-body-sm rounded-[var(--radius-pill)] bg-[var(--scrim)] px-3 py-1 font-bold text-[var(--surface-card)]"
              >
                {b}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="p-4">
        <h3 className="text-heading-lg leading-tight font-bold text-[var(--ink)]">
          {m.name}
        </h3>

        {/* Ligne méta : ★ note · (nb avis) · catégorie. */}
        <p className="text-body-lg mt-1.5 flex items-center gap-1.5 font-medium text-[var(--ink)]">
          <Star
            aria-hidden
            className="size-4 fill-[var(--rating)] text-[var(--rating)]"
          />
          {m.rating.toFixed(1)}
          <span className="text-[var(--ink-muted)]">({m.reviews})</span>
          <span aria-hidden className="text-[var(--ink-muted)]">
            ·
          </span>
          <span className="truncate">{m.category}</span>
        </p>

        {/* Ligne livraison : délai · vélo · prix (barré si remise). */}
        <p className="text-body-lg mt-1 flex items-center gap-1.5 font-medium text-[var(--ink)]">
          {m.eta}
          <span aria-hidden className="text-[var(--ink-muted)]">
            ·
          </span>
          <Bike aria-hidden className="size-4 text-[var(--brand)]" />
          <span className="font-bold">{m.fee}</span>
          {m.feeBefore && (
            <s className="font-medium text-[var(--ink-muted)]">{m.feeBefore}</s>
          )}
        </p>
      </div>
    </article>
  );
}
