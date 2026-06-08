"use client";

import { useEffect, useState } from "react";
import { useDriverDark } from "@/lib/driver/theme-store";

/**
 * Racine de l'espace livreur : pose `data-space="driver"` + les variables de
 * police, et applique la classe `dark` selon le thème persisté. La classe sombre
 * n'est appliquée qu'APRÈS montage (drapeau `mounted`) pour que le rendu serveur
 * et le 1er rendu client soient identiques (clair) → pas de mismatch
 * d'hydratation (#418). Léger flash clair→sombre acceptable.
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

  return (
    <div
      data-space="driver"
      className={[fontVars, isDark ? "dark" : ""].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}
