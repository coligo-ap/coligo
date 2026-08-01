"use client";

import { useEffect } from "react";

/**
 * Remet la page EN HAUT à l'arrivée sur un portail d'authentification.
 *
 * Défaut constaté : après une déconnexion, on retombait tout EN BAS du
 * portail — au milieu des arguments marketing — au lieu du formulaire de
 * connexion. Le navigateur restaure la position de défilement de la dernière
 * visite ; sur une page qu'on quitte en ayant scrollé, il rend donc le bas.
 *
 * On désactive cette restauration pour ces écrans et on force le haut : la
 * connexion et l'inscription doivent être la PREMIÈRE chose visible. Le reste
 * se découvre en descendant, pour qui le veut.
 *
 * `instant` et non « smooth » : un défilement animé au chargement donne
 * l'impression d'une page qui bouge toute seule.
 */
export function ScrollToTopOnMount() {
  useEffect(() => {
    try {
      if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    } catch {
      /* navigateur sans l'API : le scrollTo ci-dessous suffit */
    }
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    // Second passage après peinture : certains navigateurs restaurent la
    // position APRÈS le premier rendu, ce qui annulerait l'appel ci-dessus.
    const t = window.setTimeout(() => window.scrollTo(0, 0), 60);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}
