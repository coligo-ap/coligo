"use server";

import { cookies } from "next/headers";
import { THEME_COOKIE, type Theme } from "./theme";

/**
 * Change le thème de l'app (clair par défaut — le mode sombre est un CHOIX
 * de l'utilisateur via le header, on ne suit plus le réglage système).
 * Pose le cookie (1 an) ; le layout racine ajoute la classe `theme-dark`
 * sur <html>, consommée par les tokens Drive dans globals.css.
 */
export async function setTheme(next: string): Promise<{ theme: Theme }> {
  const theme: Theme = next === "dark" ? "dark" : "light";
  const store = await cookies();
  store.set(THEME_COOKIE, theme, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return { theme };
}
