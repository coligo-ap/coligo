"use client";

import { useEffect } from "react";

/**
 * Marque le <body> comme « espace client » (data-space="client") pour que le
 * mode sombre de la marketplace s'applique AUSSI au contenu portalé hors du
 * shell (sheets, dialogs Radix montés sur body). Le wrapper du CustomerShell
 * porte déjà l'attribut côté SSR (pas de flash) ; ce miroir couvre les
 * portails. Les espaces commerçant / livreur / admin ne sont pas touchés.
 */
export function ClientThemeScope() {
  useEffect(() => {
    document.body.dataset.space = "client";
    return () => {
      delete document.body.dataset.space;
    };
  }, []);
  return null;
}
