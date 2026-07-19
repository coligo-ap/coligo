"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Check, ChevronDown } from "lucide-react";
import { setLocale } from "@/i18n/actions";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locale";
import { LocaleFlag } from "@/components/i18n/locale-flag";
import { Portal } from "@/components/ui/portal";
import { cn } from "@/lib/utils";

/** Largeur fixe de la liste — nécessaire pour la positionner AVANT le rendu. */
const MENU_W = 172;
/** Hauteur estimée (3 langues) pour choisir le sens d'ouverture. */
const MENU_H = 128;
const MARGIN = 8;

/**
 * Sélecteur de langue — déclencheur sans cadre (globe + langue + chevron) dont
 * la liste est rendue dans un PORTAL en `position: fixed` :
 *
 * 1. elle ÉCHAPPE aux conteneurs `overflow-hidden` / `overflow-y-auto` (bug
 *    vécu : dans le tiroir livreur/chauffeur, la carte de section clippait la
 *    liste → impossible de voir/changer la langue) ;
 * 2. elle s'ouvre vers le BAS par défaut mais BASCULE vers le HAUT quand la
 *    place manque sous le déclencheur (règle projet : rien ne sort du champ
 *    visible) ;
 * 3. elle est clampée horizontalement dans le viewport, RTL compris.
 *
 * Pose le cookie `NEXT_LOCALE` via l'action serveur puis rafraîchit la route →
 * re-rendu avec la nouvelle locale + direction RTL.
 */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const active = useLocale() as Locale;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
  } | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const rtl = document.documentElement.dir === "rtl";
    // Alignée au bord logique « fin » du déclencheur, clampée dans l'écran.
    const left = Math.min(
      Math.max(MARGIN, rtl ? r.left : r.right - MENU_W),
      window.innerWidth - MENU_W - MARGIN
    );
    // Bas par défaut ; haut si la liste déborderait sous l'écran.
    const fitsBelow = r.bottom + 4 + MENU_H <= window.innerHeight - MARGIN;
    setPos(
      fitsBelow
        ? { top: r.bottom + 4, left }
        : { bottom: window.innerHeight - r.top + 4, left }
    );
  }, []);

  // useEffect suffit : la liste n'est rendue qu'une fois `pos` calculé — pas
  // de rendu mal placé, et pas d'avertissement useLayoutEffect côté SSR.
  useEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open, place]);

  // Fermeture au clic en dehors / Échap ; un scroll ou resize referme (la
  // position fixe deviendrait fausse — c'est le comportement standard).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(t) &&
        menuRef.current &&
        !menuRef.current.contains(t)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node) {
        if (menuRef.current.contains(e.target)) return; // scroll interne ok
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const choose = (next: Locale) => {
    setOpen(false);
    if (next === active || pending) return;
    start(async () => {
      await setLocale(next);
      router.refresh();
    });
  };

  // Code court pour le déclencheur (compact) : FR / ع / EN.
  const shortLabel: Record<Locale, string> = { fr: "FR", ar: "ع", en: "EN" };

  return (
    <div ref={triggerRef} className="relative inline-block shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Langue"
        className={cn(
          // SANS cadre : pas de bordure ni de fond, juste le texte + chevron.
          "text-muted hover:text-foreground inline-flex items-center gap-1.5 bg-transparent px-1 py-1 text-[13px] font-semibold transition-colors",
          pending && "opacity-60"
        )}
      >
        <LocaleFlag locale={active} className="w-5 shrink-0" />
        <span>{compact ? shortLabel[active] : LOCALE_LABELS[active]}</span>
        <ChevronDown
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && pos && (
        <Portal>
          <ul
            ref={menuRef}
            role="listbox"
            className="border-border bg-surface fixed z-[200] max-h-[min(60vh,320px)] overflow-y-auto rounded-xl border py-1 shadow-lg"
            style={{
              width: MENU_W,
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
            }}
          >
            {LOCALES.map((loc) => (
              <li key={loc}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active === loc}
                  onClick={() => choose(loc)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2 text-start text-[13px] transition-colors",
                    active === loc
                      ? "text-foreground font-bold"
                      : "text-muted hover:text-foreground hover:bg-surface-2"
                  )}
                >
                  <LocaleFlag locale={loc} className="w-5 shrink-0" />
                  <span className="min-w-0 flex-1">{LOCALE_LABELS[loc]}</span>
                  {active === loc && (
                    <Check className="text-primary-600 size-4 shrink-0" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </Portal>
      )}
    </div>
  );
}
