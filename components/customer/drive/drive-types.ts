/**
 * Types partagés du parcours Coligo Drive (client) — extraits de `drive-view`
 * pour que les écrans découpés (`drive-home-screen`, `drive-price-screen`,
 * `drive-map-pick`) les réutilisent sans dépendance circulaire de valeur.
 */

/** Point d'un trajet : coordonnées + libellé résolu. `gps` = départ « Ma
 *  position » (repère bleu), sinon point choisi explicitement. */
export type Pt = {
  lat: number;
  lng: number;
  text: string | null;
  gps?: boolean;
};

/** Gammes de véhicule proposées au client. */
export type Gamme = "classic" | "confort" | "moto";

/** Écran courant du parcours (machine à états locale de `DriveView`). */
export type Screen = "home" | "mappick" | "price" | "ride";

/** Onglet de trajet de l'accueil : Ville (urbain) ⇄ Inter-wilayas (longue
 *  distance, façon InDrive/Yassir). Lentille d'affichage uniquement — la
 *  détection réelle est automatique (lib/drive/interwilaya). */
export type TripMode = "ville" | "inter";
