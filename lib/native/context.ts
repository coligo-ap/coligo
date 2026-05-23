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
 *
 * Détection Sunmi : les terminaux Sunmi (V2, V3, T2 Mini…) embarquent leur
 * propre Chrome customisé qui :
 *   - met « Sunmi » dans le user-agent ;
 *   - peut être configuré pour imprimer SANS dialogue système (firmware
 *     auto-print). Dans ce mode, `window.print()` lance directement
 *     l'imprimante thermique intégrée.
 *   - peut exposer un pont JS vers leur SDK natif d'impression (différentes
 *     conventions selon les modèles : `window.sunmiPrinter`, `SunmiBridge`…).
 * On expose des helpers pour adapter l'UX (label « Impression directe » si
 * Sunmi, plutôt que « Imprimer le ticket ») et pour brancher le SDK natif
 * le jour venu.
 */

export type NativePlatform = "web" | "ios" | "android";

export function isNative(): boolean {
  return false;
}

export function getNativePlatform(): NativePlatform {
  return "web";
}

/**
 * Vrai si le navigateur tourne sur un terminal Sunmi (V2/V3/T2 Mini…).
 * Heuristique UA — fiable car Sunmi modifie l'agent par défaut. `false` côté
 * serveur (pas de `navigator`).
 */
export function isSunmiDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /sunmi/i.test(navigator.userAgent || "");
}

/**
 * Vrai si un pont JS natif d'impression est disponible (Sunmi SDK injecté
 * dans le WebView, ou Capacitor APK avec plugin imprimante branché).
 * Côté PWA pure, retourne `false` → on retombe sur `window.print()`.
 *
 * Quand l'APK Capacitor sera prêt, brancher la détection ici :
 *   // return Capacitor.isPluginAvailable("ThermalPrinter");
 *
 * Quand on intégrera le SDK Sunmi via leur WebView (sans Capacitor),
 * brancher la détection du pont injecté ici :
 *   // return typeof (window as any).sunmiPrinter?.printString === "function";
 */
export function hasNativePrinterBridge(): boolean {
  return false;
}
