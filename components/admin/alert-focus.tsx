"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ALERT_FOCUS_PARAM } from "@/lib/alerts/alert-model";

/**
 * SURBRILLANCE D'ATTERRISSAGE des alertes super-admin (100 % frontend).
 *
 * Quand un admin clique une alerte (cloche, centre d'alertes, bandeau de
 * domaine), le lien porte `?focus=<code>`. Ce composant — monté UNE fois dans
 * le layout admin — repère alors sur la page d'arrivée le(s) élément(s)
 * marqué(s) `data-alert-focus~="<code>"`, scrolle dessus et applique la classe
 * `.alert-focus-ring` (halo violet clignotant, cf. globals.css) pendant
 * quelques secondes pour montrer immédiatement OÙ se traite l'alerte.
 *
 * - Un même élément peut cibler plusieurs codes : `data-alert-focus="a b"`.
 * - Le contenu arrive souvent en streaming (loading.tsx) → on re-cherche la
 *   cible par petites tentatives pendant ~12 s avant d'abandonner en silence.
 * - Une fois le clignotement fini, le paramètre est retiré de l'URL
 *   (history.replaceState, pas de round-trip serveur) pour ne pas re-clignoter
 *   au refresh / partage du lien.
 */
export function AlertFocusEffect() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const code = searchParams.get(ALERT_FOCUS_PARAM);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    let timer: number | undefined;
    let marked: Element[] = [];

    const clear = () => {
      for (const el of marked) el.classList.remove("alert-focus-ring");
      marked = [];
    };

    const stripParam = () => {
      const url = new URL(window.location.href);
      if (!url.searchParams.has(ALERT_FOCUS_PARAM)) return;
      url.searchParams.delete(ALERT_FOCUS_PARAM);
      window.history.replaceState(window.history.state, "", url.toString());
    };

    let tries = 0;
    const tick = () => {
      if (cancelled) return;
      const els = Array.from(
        document.querySelectorAll(`[data-alert-focus~="${CSS.escape(code)}"]`)
      );
      if (els.length > 0) {
        marked = els;
        for (const el of els) el.classList.add("alert-focus-ring");
        els[0].scrollIntoView({ behavior: "smooth", block: "center" });
        // Fin du clignotement : on nettoie la classe PUIS l'URL (l'ordre évite
        // que la mise à jour d'URL ne re-déclenche l'effet et coupe le halo).
        timer = window.setTimeout(() => {
          clear();
          stripParam();
        }, 6200);
        return;
      }
      // Cible pas encore rendue (streaming / onglet) → on réessaie un peu.
      if (++tries < 40) timer = window.setTimeout(tick, 300);
    };
    tick();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      clear();
    };
  }, [code, pathname]);

  return null;
}
