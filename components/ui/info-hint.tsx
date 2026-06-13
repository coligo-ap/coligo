"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Petit indicateur « i » d'aide à côté d'un libellé de paramètre. Au survol
 * (souris) ou au tap (mobile), affiche une bulle : explication résumée + un
 * exemple concret. But : faciliter la formation/compréhension des réglages
 * (pages /admin/zones, /admin/drive, /admin/settings…) sans alourdir l'UI.
 *
 * La bulle est rendue dans un PORTAIL (document.body) en position `fixed`,
 * calculée depuis la position de l'icône : elle n'est donc JAMAIS coupée par le
 * `overflow` d'un modal/formulaire ni masquée par un autre calque, et se replace
 * automatiquement (au-dessus/en dessous + recadrage horizontal) pour rester
 * entièrement visible à l'écran.
 *
 * Les anciens props `align`/`side` restent acceptés mais sont désormais ignorés
 * (le placement est automatique).
 */
export function InfoHint({
  text,
  example,
  title,
  className,
}: {
  /** Explication courte (1–2 phrases). */
  text: string;
  /** Exemple concret (mis en valeur). */
  example?: string;
  /** Titre optionnel (sinon le libellé voisin suffit). */
  title?: string;
  /** @deprecated placement automatique désormais. */
  align?: "start" | "end";
  /** @deprecated placement automatique désormais. */
  side?: "top" | "bottom";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => setMounted(true), []);

  const cancelClose = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  // Léger délai à la sortie souris : laisse le temps d'aller survoler la bulle
  // (qui est dans un portail, donc séparée de l'icône) sans qu'elle se ferme.
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  // Calcule la position fixed de la bulle à partir du rect de l'icône, en la
  // gardant dans l'écran (8 px de marge), au-dessus si pas de place en dessous.
  const place = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const m = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = popRef.current?.offsetWidth ?? 240;
    const ph = popRef.current?.offsetHeight ?? 120;
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(m, Math.min(left, vw - pw - m));
    const below = r.bottom + 6 + ph + m <= vh;
    const top = below ? r.bottom + 6 : Math.max(m, r.top - ph - 6);
    setPos({ top, left });
  }, []);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    // Reposition au scroll (y compris conteneurs internes via capture) / resize.
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  // Fermeture au clic en dehors (cas mobile : ouverture au tap).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (btnRef.current?.contains(tgt) || popRef.current?.contains(tgt))
        return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => () => cancelClose(), []);

  return (
    <span className={cn("inline-flex align-middle", className)}>
      <button
        ref={btnRef}
        type="button"
        aria-label={title ?? "Plus d'informations"}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          cancelClose();
          setOpen((v) => !v);
        }}
        onMouseEnter={() => {
          cancelClose();
          setOpen(true);
        }}
        onMouseLeave={scheduleClose}
        className="text-muted hover:text-primary-600 inline-flex size-4 items-center justify-center rounded-full"
      >
        <Info className="size-3.5" />
      </button>

      {open &&
        mounted &&
        createPortal(
          <div
            ref={popRef}
            role="tooltip"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              zIndex: 9999,
              // Invisible tant que non positionnée (évite un flash en 0,0).
              visibility: pos ? "visible" : "hidden",
            }}
            className="border-border text-foreground w-60 max-w-[calc(100vw-16px)] rounded-[10px] border bg-white p-2.5 text-start text-[11px] leading-snug font-normal whitespace-normal shadow-xl"
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
          </div>,
          document.body
        )}
    </span>
  );
}
