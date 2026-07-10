"use client";

import { getNativePlatform, isNative } from "./context";

/**
 * Version de l'application INSTALLÉE sur l'appareil.
 *
 * N'a de sens que dans l'APK : là, l'utilisateur porte une version figée
 * (`versionName` + `versionCode` du build Play), qu'il met à jour via les
 * In-App Updates. Sur le web / la PWA, il n'y a pas de « version installée » —
 * la page servie est toujours la dernière — donc on renvoie `null` et le
 * libellé ne s'affiche pas.
 *
 * Le plugin `@capacitor/app` est chargé en import DYNAMIQUE : le bundle web ne
 * l'embarque pas.
 */
export type InstalledVersion = { version: string; build: string };

export async function getInstalledAppVersion(): Promise<InstalledVersion | null> {
  if (!isNative()) return null;
  const platform = getNativePlatform();
  if (platform !== "android" && platform !== "ios") return null;

  try {
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    // `version` = versionName (« 1.0.13 »), `build` = versionCode (« 16 »).
    return { version: info.version, build: info.build };
  } catch {
    // Sideload / plugin absent : on n'affiche rien plutôt qu'une valeur fausse.
    return null;
  }
}
