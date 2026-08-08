"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Portal } from "@/components/ui/portal";
import { cn } from "@/lib/utils";

/**
 * FEUILLE / MODALE — la primitive qui manquait le plus : 80 fichiers
 * construisaient leur propre `fixed inset-0` avec chacun leur voile, leur
 * rayon, leur gestion d'Échap et leur zone sûre (souvent oubliée).
 *
 * Comportement : ancrée en BAS sur mobile, centrée à partir de `sm` — le
 * standard Bolt Food. Ferme sur Échap et sur clic du voile.
 *
 * Deux pièges déjà payés, traités ici une fois pour toutes :
 *  - zone sûre : `calc(env(safe-area-inset-bottom) + marge)`, JAMAIS
 *    `max(marge, env(…))` — sinon le contenu COLLE à la barre système dès
 *    qu'elle dépasse la marge ;
 *  - rendu via `<Portal>` : à l'intérieur d'un conteneur `position: fixed`
 *    (coques Drive), un `z-index` élevé reste piégé et passe sous la nav.
 *
 * RTL : le bouton de fermeture est posé en `end-*` (propriété logique), donc à
 * gauche en arabe.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  /** Masque la croix (feuille purement informative fermée par une action). */
  hideClose,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  hideClose?: boolean;
  className?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const width = {
    sm: "sm:max-w-sm",
    md: "sm:max-w-md",
    lg: "sm:max-w-lg",
  }[size];

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
      >
        <button
          type="button"
          aria-label="Fermer"
          onClick={onClose}
          className="bg-plain-black/45 absolute inset-0"
        />
        <div
          className={cn(
            "bg-surface relative flex max-h-[92dvh] w-full flex-col rounded-t-lg",
            "sm:rounded-lg",
            "animate-fade-in",
            width,
            className
          )}
          style={{
            paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)",
          }}
        >
          {(title || !hideClose) && (
            <div className="flex items-start gap-3 px-4 pt-4 pb-2">
              <div className="min-w-0 flex-1">
                {title && (
                  <h2 className="text-title-sm text-foreground truncate font-extrabold">
                    {title}
                  </h2>
                )}
                {description && (
                  <p className="text-label-lg text-muted mt-0.5 leading-snug">
                    {description}
                  </p>
                )}
              </div>
              {!hideClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fermer"
                  className="rounded-control text-muted hover:bg-surface-2 hover:text-foreground -me-1 grid size-8 shrink-0 place-items-center"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
            {children}
          </div>
          {footer && (
            <div className="border-border border-t px-4 pt-3">{footer}</div>
          )}
        </div>
      </div>
    </Portal>
  );
}
