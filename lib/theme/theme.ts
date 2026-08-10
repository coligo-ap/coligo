/**
 * Thème de l'app : CLAIR à chaque ouverture (décision produit du 10/08/2026),
 * sombre sur choix utilisateur — valable LE TEMPS DE LA SESSION seulement.
 *
 * Le cookie est un cookie de SESSION (posé sans max-age par `setTheme`) : il
 * meurt à la fermeture de l'app/du navigateur → toute réouverture repart en
 * clair, même si le client avait choisi le sombre la veille, et quel que soit
 * le réglage sombre du téléphone (on ne lit jamais prefers-color-scheme).
 *
 * Le NOM a changé (`coligo_theme` → `coligo_theme_s`) exprès : les anciens
 * cookies persistants « 1 an » déjà posés sur les appareils sont ainsi
 * IGNORÉS dès ce déploiement — sans renommage, un téléphone passé en sombre
 * avant le changement serait resté sombre pour toujours.
 */
export const THEME_COOKIE = "coligo_theme_s";
export type Theme = "light" | "dark";
