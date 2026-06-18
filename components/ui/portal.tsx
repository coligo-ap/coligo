"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Rend ses enfants dans `document.body` (hors de l'arbre courant). Indispensable
 * pour les modales/feuilles rendues à l'intérieur d'un conteneur qui crée un
 * contexte d'empilement (ex. `.drive-screen` / `.drive-page` en `position:
 * fixed`) : sans ça, un `z-index` élevé reste PIÉGÉ dans ce conteneur et passe
 * SOUS des éléments frères de plus haut niveau (ex. la barre de nav persistante
 * de la coque chauffeur). Portalisé vers le body, le `z-index` de la modale est
 * comparé à la racine → elle recouvre bien toute l'interface, nav comprise.
 *
 * SSR-safe : ne rend rien tant que le composant n'est pas monté côté client.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
