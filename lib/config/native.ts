/**
 * Marqueur « on tourne dans une app installée » (APK Capacitor).
 *
 * Posé par `app/api/start/[role]/route.ts` — la server.url des APK, que
 * personne d'autre ne visite — et relu par `app/layout.tsx` pour écrire
 * `data-app="native"` sur <html> AVANT le premier paint.
 *
 * Pourquoi pas `window.Capacitor` : l'intro (components/brand/intro-splash.tsx)
 * doit décider de s'afficher dans un script inline, avant tout rendu. Si le pont
 * natif n'est pas encore injecté à cet instant, la détection échoue en silence
 * et l'utilisateur voit le <body> blanc pendant toute l'hydratation. Le cookie
 * supprime la course : c'est le serveur qui tranche.
 *
 * Ce fichier n'est PAS dans route.ts : Next rejette tout export d'un route
 * handler qui n'est ni une méthode HTTP ni une option de segment.
 */
export const NATIVE_COOKIE = "coligo_native";

/** Un an — le cookie est de toute façon rafraîchi à chaque démarrage de l'app. */
export const NATIVE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
