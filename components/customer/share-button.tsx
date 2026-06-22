"use client";

import { Share2 } from "lucide-react";
import { toast } from "@/components/ui/toast";

/**
 * Bouton « Partager » de la barre du haut (fiche commerçant). Utilise l'API de
 * partage native (`navigator.share`) si disponible — feuille de partage système
 * (WhatsApp, SMS, etc.) — sinon copie le lien de la page courante dans le
 * presse-papiers et affiche un toast. Style passé via `className` pour coller
 * aux autres boutons ronds de la barre.
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
      toast.success(copiedMsg);
    } catch {
      /* presse-papiers indisponible — silencieux */
    }
  };

  return (
    <button
      type="button"
      onClick={onShare}
      aria-label={label}
      className={className}
    >
      <Share2 className="size-[18px]" />
    </button>
  );
}
