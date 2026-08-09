/**
 * Point d'entrée des capacités « natives » (géoloc, notif, scan, impression).
 *
 * Règle projet : le code applicatif n'appelle JAMAIS `navigator.geolocation`,
 * `Notification`, `window.print()` ou `navigator.mediaDevices` directement.
 * Tout passe par `lib/native`. Le jour où on bascule en Capacitor APK, on
 * change `context.ts` et les implémentations sans rien toucher des écrans.
 */

export * from "./context";
export * from "./geolocation";
export * from "./geo-permission";
export * from "./settings";
export * from "./notify";
export * from "./printer";
export * from "./scanner";
