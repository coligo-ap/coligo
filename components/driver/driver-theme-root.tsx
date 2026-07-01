"use client";

import { useEffect, useState } from "react";
import { useDriverDark } from "@/lib/driver/theme-store";
import { DriverQueryProvider } from "@/components/driver/driver-query-provider";

/**
 * Racine de l'espace livreur : pose `data-space="driver"` + les variables de
 * police, et applique la classe `dark` selon le thème persisté. La classe sombre
 * n'est appliquée qu'APRÈS montage (drapeau `mounted`) pour que le rendu serveur
 * et le 1er rendu client soient identiques (clair) → pas de mismatch
 * d'hydratation (#418). Léger flash clair→sombre acceptable.
 *
 * MIROIR SUR <body> : les composants montés via <Portal> (tiroir partenaire,
 * feuilles…) vivent sur document.body, HORS de ce wrapper — sans miroir, les
 * tokens `--surface/--ink/--line…`, les polices Sora/Jakarta et la classe
 * `dark` n'y résolvaient PAS → tiroir TRANSPARENT en clair et figé en sombre.
 * On réplique donc l'attribut d'espace + les classes de police + `dark` sur le
 * <body> (même pattern que la coque client, cf. dark mode client).
 */
export function DriverThemeRoot({
  children,
  fontVars,
}: {
  children: React.ReactNode;
  fontVars: string;
}) {
  const dark = useDriverDark();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && dark;

  // Miroir espace + polices sur <body> (pour les portails). Nettoyé au démontage
  // (navigation vers un autre espace) pour ne jamais fuir hors du livreur.
  useEffect(() => {
    const body = document.body;
    body.setAttribute("data-space", "driver");
    const fontClasses = fontVars.split(" ").filter(Boolean);
    body.classList.add(...fontClasses);
    return () => {
      body.removeAttribute("data-space");
      body.classList.remove(...fontClasses);
    };
  }, [fontVars]);

  // Miroir du thème sombre sur <body> (les portails suivent la bascule live).
  useEffect(() => {
    document.body.classList.toggle("dark", isDark);
    return () => {
      document.body.classList.remove("dark");
    };
  }, [isDark]);

  return (
    <div
      data-space="driver"
      className={[fontVars, isDark ? "dark" : ""].filter(Boolean).join(" ")}
    >
      <DriverQueryProvider>{children}</DriverQueryProvider>
    </div>
  );
}
