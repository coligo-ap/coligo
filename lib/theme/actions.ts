"use server";

import { cookies } from "next/headers";
import { THEME_COOKIE, type Theme } from "./theme";

/**
 * Change le thème de l'app (clair par défaut — le mode sombre est un CHOIX de
 * l'utilisateur, jamais le réglage système). Cookie de SESSION (pas de
 * max-age, décision produit du 10/08/2026) : le choix tient le temps de la
 * session — navigations et rechargements compris — puis meurt avec elle, et
 * chaque OUVERTURE de l'app repart en clair. Le layout racine ajoute la
 * classe `theme-dark` sur <html>, consommée par les tokens dans globals.css.
 */
export async function setTheme(next: string): Promise<{ theme: Theme }> {
  const theme: Theme = next === "dark" ? "dark" : "light";
  const store = await cookies();
  store.set(THEME_COOKIE, theme, {
    path: "/",
    sameSite: "lax",
  });
  return { theme };
}
