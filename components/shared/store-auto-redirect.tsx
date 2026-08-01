"use client";

import { useEffect } from "react";
import { detectPlatformClient, storeUrlFor } from "@/lib/config/app-stores";

/**
 * Rattrapage de redirection CÔTÉ NAVIGATEUR.
 *
 * Le serveur a déjà tranché d'après le User-Agent ; s'il a laissé passer, c'est
 * qu'il a vu « ordinateur ». Or un iPad récent se déclare comme un Mac : seul
 * le navigateur peut le démasquer (écran tactile + plateforme Apple). Dans ce
 * cas on part vers l'App Store, sans laisser de page morte derrière soi.
 *
 * `replace` et non `assign` : le bouton Retour ne doit pas ramener sur une page
 * qui redirige aussitôt (piège classique de boucle).
 */
export function StoreAutoRedirect() {
  useEffect(() => {
    const url = storeUrlFor(detectPlatformClient());
    if (url) window.location.replace(url);
  }, []);
  return null;
}
