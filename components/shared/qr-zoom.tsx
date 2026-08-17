"use client";

import { useState } from "react";
import { Maximize2, X } from "lucide-react";
import { OrderQr } from "@/components/customer/order-qr";
import { Portal } from "@/components/ui/portal";

// =============================================================================
// QrZoom — un QR (OrderQr) cliquable qui s'ouvre en PLEIN ÉCRAN pour faciliter
// le scan (par le livreur, le commerçant, ou un ami). Réutilisable :
//   - code de retrait sur la commande client,
//   - QR d'encaissement côté commerçant,
//   - tout autre QR à présenter.
// Le plein écran est PORTALISÉ vers <body> (règle système : un `fixed inset-0`
// rendu dans l'arbre reste piégé par tout ancêtre créant un contexte
// d'empilement → le texte de la page se superposait au QR agrandi) et monte à
// z-[200] (niveau feuilles/modales : RECOUVRE header, nav et bandeaux).
// =============================================================================
export function QrZoom({
  value,
  size = 96,
  caption,
  fullValue,
  expandLabel,
  bare = false,
  ink,
}: {
  value: string;
  /** Taille de la vignette (px). */
  size?: number;
  /** Légende affichée sous le grand QR en plein écran. */
  caption?: string;
  /** Texte lisible affiché en grand sous le QR (ex. le code). Défaut: value. */
  fullValue?: string;
  /**
   * Libellé d'un VRAI bouton « Agrandir » sous la vignette. Sans lui, la seule
   * affordance est la pastille d'angle — que beaucoup d'utilisateurs ne voient
   * pas. Avec un scan à faire par un tiers (livreur, commerçant), le geste
   * doit être ÉVIDENT : on écrit ce qu'il fait.
   */
  expandLabel?: string;
  /**
   * Vignette NUE : le QR seul, PLEIN CADRE, sans pastille d'angle ni bouton
   * « Agrandir » — pour les cartes fidélité où le QR doit être scannable tel
   * quel (le tap ouvre quand même le plein écran, utile en caisse sombre).
   */
  bare?: boolean;
  /** Encre des modules de la VIGNETTE (ex. violet carte fidélité). Le plein
   *  écran reste noir sur blanc — contraste maximal pour le scan en caisse. */
  ink?: string;
}) {
  const [open, setOpen] = useState(false);

  const overlay = open && (
    <Portal>
      <div
        className="bg-background fixed inset-0 z-[200] flex flex-col items-center justify-center p-6"
        onClick={() => setOpen(false)}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Fermer"
          className="bg-surface-2 text-foreground absolute top-[calc(env(safe-area-inset-top)+1rem)] right-4 grid size-10 place-items-center rounded-full"
        >
          <X className="size-5" />
        </button>

        <div onClick={(e) => e.stopPropagation()} className="text-center">
          <div
            className="inline-block rounded-xl border border-[var(--color-border)] p-4"
            // Cadre TOUJOURS blanc (cf. OrderQr) — pas la classe `bg-white`
            // qui est remappée en sombre côté client.
            style={{ backgroundColor: "#ffffff" }}
          >
            <OrderQr value={value} size={288} />
          </div>
          {(fullValue ?? value) && (
            <p className="text-foreground mt-5 text-3xl font-black tracking-[8px] tabular-nums">
              {fullValue ?? value}
            </p>
          )}
          {caption && (
            <p className="text-muted mx-auto mt-3 max-w-xs text-sm font-medium">
              {caption}
            </p>
          )}
        </div>
      </div>
    </Portal>
  );

  if (bare) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={expandLabel ?? "Agrandir le QR"}
          className="inline-flex shrink-0 transition-transform active:scale-95"
        >
          <OrderQr value={value} size={size} ink={ink} frameless />
        </button>
        {overlay}
      </>
    );
  }

  return (
    <>
      <span className="inline-flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={expandLabel ?? "Agrandir le QR"}
          className="relative inline-flex shrink-0 transition-transform active:scale-95"
        >
          <OrderQr value={value} size={size} />
          <span className="bg-foreground/80 absolute right-1 bottom-1 grid size-6 place-items-center rounded-full text-white shadow">
            <Maximize2 className="size-3.5" />
          </span>
        </button>
        {expandLabel && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            // `whitespace-nowrap` : la colonne est large comme la VIGNETTE
            // (92 px sur la commande) — sans lui, « Agrandir le QR » se coupe
            // en deux lignes.
            className="rounded-control border-border bg-surface text-foreground hover:bg-surface-2 text-label-lg inline-flex items-center gap-1.5 border px-3 py-1.5 font-bold whitespace-nowrap transition-colors"
          >
            <Maximize2 className="size-3.5" />
            {expandLabel}
          </button>
        )}
      </span>

      {overlay}
    </>
  );
}
