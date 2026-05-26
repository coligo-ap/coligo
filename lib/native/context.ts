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

/**
 * Vrai si on tourne dans un WebView Capacitor (APK Android / iOS).
 * Détection runtime via le pont `window.Capacitor` injecté par le natif —
 * pas d'import direct du SDK Capacitor pour rester compatible PWA pure
 * (le bundle web n'a pas besoin de @capacitor/core).
 */
export function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

export function getNativePlatform(): NativePlatform {
  if (typeof window === "undefined") return "web";
  const cap = (
    window as unknown as { Capacitor?: { getPlatform?: () => string } }
  ).Capacitor;
  const p = cap?.getPlatform?.();
  if (p === "android") return "android";
  if (p === "ios") return "ios";
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
 * Vrai si un pont JS natif d'impression est disponible (plugin Capacitor
 * SunmiPrinter ou autre pont injecté). Côté PWA pure, retourne `false` → on
 * retombe sur `window.print()`.
 *
 * Détection sync : on regarde juste si `Capacitor.Plugins.SunmiPrinter` a
 * été injecté par le runtime natif. L'état réel du service AIDL (bindé ou
 * non) est résolu async par `isSunmiPrinterAvailable()` côté printer.
 */
export function hasNativePrinterBridge(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as unknown as {
      Capacitor?: {
        Plugins?: Record<string, unknown>;
        isNativePlatform?: () => boolean;
        getPlatform?: () => string;
      };
    }
  ).Capacitor;
  const result = !!cap?.Plugins?.SunmiPrinter;
  // Log en console quel que soit l'env — on a besoin de voir le résultat
  // dans le logcat Sunmi pour diagnostiquer pourquoi un APK avec le plugin
  // ne déclencherait pas l'impression native.
  // JSON.stringify pour que chromium n'affiche pas « [object Object] » et
  // qu'on voie le détail dans `adb logcat -s chromium:*`.
  if (typeof console !== "undefined") {
    try {
      console.info(
        "[printer] hasNativePrinterBridge " +
          JSON.stringify({
            hasCapacitor: !!cap,
            isNative: cap?.isNativePlatform?.() ?? null,
            platform: cap?.getPlatform?.() ?? null,
            plugins: cap?.Plugins ? Object.keys(cap.Plugins) : [],
            result,
          })
      );
    } catch {
      /* ignored */
    }
  }
  return result;
}
