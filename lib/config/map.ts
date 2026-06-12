// =============================================================================
// Fournisseur de tuiles cartographiques — POINT UNIQUE de configuration.
// =============================================================================
// On utilise OpenFreeMap : tuiles vectorielles MapLibre GRATUITES, ILLIMITÉES,
// SANS clé API ni inscription, usage commercial autorisé. Idéal car la carte
// est sollicitée intensivement (chaque fiche commerçant + suivi livreur live).
//
// Le rendu (MapLibre GL JS) et nos marqueurs custom (pin violet, position
// client, marqueur livreur) sont INDÉPENDANTS du fournisseur de tuiles : seul
// le style d'arrière-plan ci-dessous change si on veut un jour migrer.
//
// Styles disponibles (https://openfreemap.org) :
//   - positron : clair/épuré, SANS commerces ni lieux publics
//   - liberty  : rues détaillées + POI (commerces, mosquées, écoles, cafés…)
//   - bright   : clair, plus contrasté
//
// On utilise `liberty` : les utilisateurs se repèrent grâce aux commerces et
// lieux publics affichés (demande produit — retrouver une adresse est bien
// plus facile avec les enseignes visibles qu'avec un fond épuré).
//
// Attribution : MapLibre ajoute automatiquement l'attribution
// OpenFreeMap / OpenStreetMap via le style. NE PAS la masquer (requis par la
// licence). On la garde en mode `compact` (discrète) sur chaque carte.
// =============================================================================

export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
