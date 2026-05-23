/**
 * Détection de l'environnement d'exécution.
 *
 * Aujourd'hui : 100% web (PWA). Le jour où on emballe l'app en APK via
 * Capacitor, on bascule ici (et SEULEMENT ici + dans les implémentations
 * concrètes de `lib/native/*`). Le code applicatif n'a JAMAIS à se soucier
 * de la plateforme.
 *
 *   // import { Capacitor } from "@capacitor/core";
 *   // export function isNative() { return Capacitor.isNativePlatform(); }
 *   // export function getNativePlatform() { return Capacitor.getPlatform(); }
 */

export type NativePlatform = "web" | "ios" | "android";

export function isNative(): boolean {
  return false;
}

export function getNativePlatform(): NativePlatform {
  return "web";
}
