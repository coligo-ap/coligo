"use client";

import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Petit indicateur « i » d'aide à côté d'un libellé de paramètre. Au survol
 * (souris) ou au tap (mobile), affiche une bulle : explication résumée + un
 * exemple concret. But : faciliter la formation/compréhension des réglages
 * (pages /admin/zones, /admin/drive, etc.) sans alourdir l'interface.
 *
 * Usage : <InfoHint text="…" example="…" /> juste après le texte du label.
 */
export function InfoHint({
  text,
  example,
  title,
  align = "start",
  side = "bottom",
  className,
}: {
  /** Explication courte (1–2 phrases). */
  text: string;
  /** Exemple concret (mis en valeur). */
  example?: string;
  /** Titre optionnel (sinon le libellé voisin suffit). */
  title?: string;
  /** Alignement horizontal de la bulle (évite de sortir de l'écran). */
  align?: "start" | "end";
  /** Côté d'ouverture vertical. */
  side?: "top" | "bottom";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Fermeture au clic en dehors (cas mobile : ouverture au tap).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <span
      ref={ref}
      className={cn("relative inline-flex align-middle", className)}
    >
      <button
        type="button"
        aria-label={title ?? "Plus d'informations"}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="text-muted hover:text-primary-600 inline-flex size-4 items-center justify-center rounded-full"
      >
        <Info className="size-3.5" />
      </button>

      {open && (
        <span
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className={cn(
            "border-border text-foreground absolute z-50 w-60 max-w-[78vw] rounded-[10px] border bg-white p-2.5 text-start text-[11px] leading-snug font-normal whitespace-normal shadow-xl",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
            align === "end" ? "end-0" : "start-0"
          )}
        >
          {title && (
            <span className="text-foreground mb-0.5 block text-xs font-bold">
              {title}
            </span>
          )}
          <span className="text-muted block">{text}</span>
          {example && (
            <span className="bg-surface-2 text-foreground mt-1.5 block rounded-[6px] px-2 py-1 text-[10.5px]">
              <b className="font-semibold">Exemple :</b> {example}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
