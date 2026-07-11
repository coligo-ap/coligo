"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";

/**
 * Bouton « Partager » de la barre du haut (fiche commerçant). Utilise l'API de
 * partage native (`navigator.share`) si disponible — feuille de partage système
 * (WhatsApp, SMS, etc.) — sinon copie le lien de la page courante dans le
 * presse-papiers. Bouton rond (icône seule) : le retour « copié » se fait EN
 * PLACE — l'icône passe à une coche verte ~1,6 s (pas de toast, cf. CLAUDE.md) —
 * avec une région live sr-only pour l'accessibilité. Style passé via `className`
 * pour coller aux autres boutons ronds de la barre.
 */
export function ShareButton({
  title,
  label,
  copiedMsg,
  className,
}: {
  title: string;
  label: string;
  copiedMsg: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onShare = async () => {
    const url = window.location.href;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        /* partage annulé par l'utilisateur — on ne fait rien */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* presse-papiers indisponible — silencieux */
    }
  };

  return (
    <button
      type="button"
      onClick={onShare}
      aria-label={copied ? copiedMsg : label}
      className={className}
    >
      {copied ? (
        <Check className="text-success-600 size-[18px]" />
      ) : (
        <Share2 className="size-[18px]" />
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? copiedMsg : ""}
      </span>
    </button>
  );
}
