#!/usr/bin/env node
/**
 * Illustrations plates de l'écran de lancement natif.
 *
 *   node scripts/coligo-illustrations.mjs
 *
 * Pourquoi ici et pas dans un outil de design : ces illustrations vivent dans
 * l'APK sous forme de VectorDrawable (aucun bitmap, aucune dépendance, net à
 * toutes les densités). Le format XML d'Android n'accepte QUE des `<path>` —
 * pas de `<circle>`, pas de `<rect>`. Ce script est donc la source de vérité :
 * on décrit avec des primitives lisibles, il convertit.
 *
 * DIRECTION ARTISTIQUE — épuré, façon Bolt / Bolt Food.
 *   Fond entièrement BLANC. Bâtiments gris clair. Goudron noir, marquage blanc.
 *   Quelques arbres verts. Le violet Coligo est réservé aux acteurs de
 *   l'histoire (boutique, voiture, porte du client, colis) : sur ce décor gris
 *   neutre, l'œil suit le violet, donc il suit le récit.
 *
 *   Une illustration = un aplat + deux valeurs. Pas de dégradé, pas de contour,
 *   pas de détail qu'on ne verrait pas à 40 dp de haut.
 *
 * Boîte 48×48, l'objet POSE sur la ligne y=44 — c'est le sol de la scène. Si tu
 * changes une illustration, garde ce pied, sinon elle flottera. SEULE exception :
 * la voiture, vue de dessus, que le Canvas centre dans sa boîte.
 *
 * Sortie : android/app/src/main/res/drawable/ic_illu_*.xml
 */

import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "android/app/src/main/res/drawable");

const P = {
  white: "#FFFFFF",
  snow: "#F4F6F9", // face éclairée d'un immeuble
  grey: "#E7EBF0", // corps d'immeuble
  greyDk: "#D2D8E0", // toit, ombre propre
  greyLn: "#B9C2CC", // menuiseries, antenne
  glass: "#CBD5E1", // vitrages des bâtiments
  tint: "#2F3A4C", // verre teinté, vu de dessus
  tintUp: "#3D4B60", // pare-brise : un cran plus clair que le toit
  skin: "#F0C6A4", // les têtes, vues de dessus
  violet: "#6C2BD9",
  violetD: "#4B1FA6",
  violetL: "#8A4DFF",
  rose: "#FF2D7A",
  green: "#23C87E",
  greenD: "#16A667",
  trunk: "#8D949E",
  kraft: "#E5B980",
  kraftD: "#C9974F",
  lamp: "#FFE9A8",
};

/**
 * La silhouette de Model 3 vue de dessus, déclinable en deux teintes.
 *
 * Ce qui la rend reconnaissable, dans l'ordre où l'œil le lit :
 *  - le museau TRONQUÉ qui se rétrécit, sans calandre — aucune thermique n'a ce nez ;
 *  - le toit de verre d'un seul tenant, du pare-brise à la lunette arrière ;
 *  - les épaules pleines au milieu, la poupe qui se pince ;
 *  - les rétroviseurs sur tige, seuls appendices de la caisse.
 *
 * Le pare-brise est d'un cran plus clair que le pavillon : sans lui, la voiture
 * n'a pas de sens de marche tant qu'elle ne bouge pas. Caisse 41 unités sur 16,
 * soit 2,6 — le rapport réel d'une Model 3 (4,69 m sur 1,85 m).
 *
 * `cabin` reçoit les formes à poser DANS l'habitacle (têtes des occupants) :
 * elles doivent passer après le vitrage, sinon le verre les recouvre.
 */
const tesla = (bodyColor, cabin) => [
  {
    d:
      "M4.6,24 C4.6,20.8 5.8,18.6 8.4,17.6 " +
      "C14.6,15.7 30.0,15.5 36.0,17.2 " +
      "C41.0,18.6 44.6,20.6 45.4,24 " +
      "C44.6,27.4 41.0,29.4 36.0,30.8 " +
      "C30.0,32.5 14.6,32.3 8.4,30.4 " +
      "C5.8,29.4 4.6,27.2 4.6,24 Z",
    fill: bodyColor,
  },
  // rétroviseurs : tige courte, coquille ovale
  { rect: [29.0, 15.4, 1.3, 1.6, 0.6], fill: P.violetD },
  { rect: [28.0, 13.4, 3.4, 2.1, 1.0], fill: P.violetD },
  { rect: [29.0, 31.0, 1.3, 1.6, 0.6], fill: P.violetD },
  { rect: [28.0, 32.5, 3.4, 2.1, 1.0], fill: P.violetD },
  // le toit de verre, d'un bout à l'autre
  {
    d:
      "M14.8,19.8 C19.4,18.5 28.8,18.5 32.6,19.8 " +
      "C34.0,20.4 34.8,21.9 34.9,24 " +
      "C34.8,26.1 34.0,27.6 32.6,28.2 " +
      "C28.8,29.5 19.4,29.5 14.8,28.2 " +
      "C13.6,27.7 13.1,26.1 13.1,24 " +
      "C13.1,21.9 13.6,20.3 14.8,19.8 Z",
    fill: P.tint,
  },
  // pare-brise
  {
    d:
      "M30.2,19.2 C32.0,19.4 33.6,20.0 34.3,20.9 " +
      "C34.8,21.6 35.0,22.7 35.0,24 " +
      "C35.0,25.3 34.8,26.4 34.3,27.1 " +
      "C33.6,28.0 32.0,28.6 30.2,28.8 Z",
    fill: P.tintUp,
  },
  ...cabin,
  // montant central
  { rect: [23.4, 19.1, 1.2, 9.8, 0.5], fill: bodyColor },
  // nervures de capot : elles courent vers le museau, elles le montrent
  { d: "M37.8,21.2 L43.2,22.5", stroke: P.violetD, w: 0.6 },
  { d: "M37.8,26.8 L43.2,25.5", stroke: P.violetD, w: 0.6 },
  { rect: [42.2, 20.7, 2.2, 2.2, 1.0], fill: P.lamp },
  { rect: [42.2, 25.1, 2.2, 2.2, 1.0], fill: P.lamp },
  { rect: [5.6, 20.8, 2.1, 2.1, 1.0], fill: P.rose },
  { rect: [5.6, 25.1, 2.1, 2.1, 1.0], fill: P.rose },
];

export const ILLUS = {
  // ---------------------------------------------------------------- la voiture
  /**
   * Berline électrique VUE DE DESSUS, nez vers la DROITE — silhouette de Model 3 :
   * museau tronqué sans calandre, épaules pleines, toit de verre d'un seul tenant.
   *
   * Vue de dessus, et pas de profil : la route est un RUBAN vu d'en haut. Une
   * voiture de profil posée dessus tient tant qu'elle roule droit, puis se
   * couche sur le flanc dès qu'elle prend le virage à 90° — deux projections sur
   * la même surface. Le décor, lui, reste en élévation : ce mélange-là est la
   * convention de la carte illustrée, et l'œil ne le relève pas.
   *
   * Dessinée SANS ses pneus : un VectorDrawable se dessine d'un bloc, on ne peut
   * pas animer une seule de ses formes. Le Canvas pose les quatre pneus dessous,
   * et fait BRAQUER les deux de devant dans le virage.
   */
  ic_illu_car_top: [...tesla(P.violet, [])],

  /**
   * La MÊME voiture, aux couleurs d'une course Coligo Drive : caisse lavande,
   * un conducteur, un passager à l'arrière. Elle remonte l'avenue en sens
   * inverse pendant la livraison — la rue n'appartient pas qu'au colis.
   *
   * Deux têtes suffisent à dire « course ». Une seule aurait dit « voiture ».
   */
  ic_illu_car_ride: [
    ...tesla(P.violetL, [
      { circle: [29.6, 21.4, 1.9], fill: P.skin }, // conducteur, avant gauche
      { circle: [19.2, 26.4, 1.8], fill: P.skin }, // passager, arrière droit
    ]),
  ],

  // ------------------------------------------------------- les deux extrémités
  /** POINT A — la boutique. Store violet : c'est le seul commerce de la rue. */
  ic_illu_shop: [
    { rect: [3.4, 7.6, 41.2, 4.4, 1.6], fill: P.greyDk },
    { rect: [5.6, 11.4, 36.8, 32.6, 1.6], fill: P.grey },
    { rect: [16.4, 12.6, 15.2, 3.4, 1.2], fill: P.violetL },
    { rect: [4.6, 17.4, 38.8, 6.4, 1.6], fill: P.violet },
    { rect: [12.6, 17.4, 3.4, 6.4, 0], fill: P.white },
    { rect: [22.3, 17.4, 3.4, 6.4, 0], fill: P.white },
    { rect: [32.0, 17.4, 3.4, 6.4, 0], fill: P.white },
    { rect: [8.4, 26.6, 13.6, 10.2, 1.4], fill: P.glass },
    { rect: [26.0, 26.6, 12.0, 17.4, 1.4], fill: P.violetD },
    { circle: [35.4, 35.6, 0.9], fill: P.white },
  ],

  /** POINT B — la maison du client. Porte violette : c'est là qu'on arrive. */
  ic_illu_house: [
    { d: "M24,5.6 L44.4,22.4 L3.6,22.4 Z", fill: P.violet },
    { rect: [8.2, 22.4, 31.6, 21.6, 1.4], fill: P.grey },
    { rect: [10.8, 26.4, 6.4, 6.4, 1.1], fill: P.glass },
    { rect: [30.8, 26.4, 6.4, 6.4, 1.1], fill: P.glass },
    { rect: [20.0, 30.2, 8.0, 13.8, 1.1], fill: P.violetD },
    { circle: [26.3, 37.2, 0.85], fill: P.white },
  ],

  /** La commande, emballée. Elle naît sur le comptoir, elle finit dans la voiture. */
  ic_illu_parcel: [
    {
      d: "M18,15.4 C18,10.8 20.6,8.2 24,8.2 C27.4,8.2 30,10.8 30,15.4",
      stroke: P.kraftD,
      w: 2.2,
    },
    {
      d:
        "M9.4,15.4 L38.6,15.4 L37.2,42.5 C37.15,43.3 36.5,44 35.6,44 " +
        "L12.4,44 C11.5,44 10.85,43.3 10.8,42.5 Z",
      fill: P.kraft,
    },
    { rect: [9.4, 15.4, 29.2, 4.4, 0.8], fill: P.kraftD },
    { rect: [18.2, 25.4, 11.6, 11.6, 2], fill: P.violet },
    { d: "M21.6,31.2 L26.4,31.2", stroke: P.white, w: 1.7 },
  ],

  /** Le repère de destination. Il tombe sur la maison quand la course s'achève. */
  ic_illu_pin: [
    {
      d:
        "M24,4 C15.7,4 9,10.7 9,19 C9,29.5 24,44 24,44 C24,44 39,29.5 39,19 " +
        "C39,10.7 32.3,4 24,4 Z",
      fill: P.violet,
    },
    { circle: [24, 18.6, 6.1], fill: P.white },
  ],

  // -------------------------------------------------------------------- décor
  /** Immeuble haut. Grille de fenêtres à deux valeurs : il ne dort pas tout entier. */
  ic_illu_building_a: [
    { rect: [7.6, 2.6, 32.8, 3.4, 1.2], fill: P.greyDk },
    { rect: [9.4, 6.0, 29.2, 38.0, 1.6], fill: P.grey },
    { rect: [13.6, 10.4, 6.4, 5.4, 1], fill: P.glass },
    { rect: [26.0, 10.4, 6.4, 5.4, 1], fill: P.greyDk },
    { rect: [13.6, 19.4, 6.4, 5.4, 1], fill: P.greyDk },
    { rect: [26.0, 19.4, 6.4, 5.4, 1], fill: P.glass },
    { rect: [13.6, 28.4, 6.4, 5.4, 1], fill: P.glass },
    { rect: [26.0, 28.4, 6.4, 5.4, 1], fill: P.greyDk },
    { rect: [13.6, 37.4, 6.4, 5.4, 1], fill: P.greyDk },
    { rect: [26.0, 37.4, 6.4, 5.4, 1], fill: P.glass },
  ],

  /**
   * Immeuble bas et large. Son bandeau de toit fut violet : à côté du store de
   * la boutique, ça faisait deux taches violettes voisines et l'œil ne savait
   * plus laquelle était le commerce. Le décor reste gris — le violet appartient
   * au récit.
   */
  ic_illu_building_b: [
    { rect: [3.6, 15.4, 40.8, 3.6, 1.3], fill: P.greyDk },
    { rect: [5.6, 19.0, 36.8, 25.0, 1.6], fill: P.grey },
    { rect: [9.4, 23.4, 7.2, 5.6, 1], fill: P.greyDk },
    { rect: [20.4, 23.4, 7.2, 5.6, 1], fill: P.glass },
    { rect: [31.4, 23.4, 7.2, 5.6, 1], fill: P.greyDk },
    { rect: [9.4, 33.0, 7.2, 5.6, 1], fill: P.glass },
    { rect: [20.4, 33.0, 7.2, 5.6, 1], fill: P.greyDk },
    { rect: [31.4, 33.0, 7.2, 5.6, 1], fill: P.glass },
  ],

  /** Tour vitrée : bandes verticales plutôt qu'une grille — la silhouette change. */
  ic_illu_building_c: [
    { d: "M24,5.4 L24,1.2", stroke: P.greyLn, w: 1.4 },
    { rect: [9.4, 5.4, 29.2, 3.2, 1.2], fill: P.greyDk },
    { rect: [11.4, 8.6, 25.2, 35.4, 1.6], fill: P.snow },
    { rect: [14.6, 12.6, 4.4, 27.4, 1.6], fill: P.glass },
    { rect: [21.8, 12.6, 4.4, 27.4, 1.6], fill: P.greyDk },
    { rect: [29.0, 12.6, 4.4, 27.4, 1.6], fill: P.glass },
  ],

  /** Arbre. Trois masses, deux verts : de la vie, pas un buisson. */
  ic_illu_tree: [
    { rect: [22.4, 28.0, 3.2, 16.0, 1.2], fill: P.trunk },
    { circle: [24, 18.4, 11.2], fill: P.greenD },
    { circle: [17.2, 24.2, 7.4], fill: P.green },
    { circle: [30.8, 24.2, 7.4], fill: P.green },
    { circle: [24, 14.6, 6.8], fill: P.green },
  ],
};

// ---------------------------------------------------------------------------
// Conversion vers `pathData`. VectorDrawable n'accepte que des <path>.
// ---------------------------------------------------------------------------
const n = (v) => Number(v.toFixed(3));

function circlePath(cx, cy, r) {
  // Deux arcs demi-cercle : `A` est supporté par VectorDrawable.
  return `M${n(cx - r)},${n(cy)} a${n(r)},${n(r)} 0 1,0 ${n(2 * r)},0 a${n(r)},${n(r)} 0 1,0 ${n(-2 * r)},0 Z`;
}

function rectPath(x, y, w, h, r = 0) {
  if (!r) return `M${n(x)},${n(y)} h${n(w)} v${n(h)} h${n(-w)} Z`;
  r = Math.min(r, w / 2, h / 2);
  return (
    `M${n(x + r)},${n(y)} h${n(w - 2 * r)}` +
    ` a${n(r)},${n(r)} 0 0,1 ${n(r)},${n(r)}` +
    ` v${n(h - 2 * r)}` +
    ` a${n(r)},${n(r)} 0 0,1 ${n(-r)},${n(r)}` +
    ` h${n(-(w - 2 * r))}` +
    ` a${n(r)},${n(r)} 0 0,1 ${n(-r)},${n(-r)}` +
    ` v${n(-(h - 2 * r))}` +
    ` a${n(r)},${n(r)} 0 0,1 ${n(r)},${n(-r)} Z`
  );
}

/** `#RRGGBB` → `#FFRRGGBB` (Android veut l'alpha en tête). */
const argb = (hex) => "#FF" + hex.replace("#", "").toUpperCase();

function toXml(shapes) {
  return shapes
    .map((s) => {
      if (s.stroke) {
        return `    <path
        android:pathData="${s.d}"
        android:strokeColor="${argb(s.stroke)}"
        android:strokeWidth="${s.w}"
        android:strokeLineCap="round"
        android:strokeLineJoin="round" />`;
      }
      let d = s.d;
      if (s.circle) d = circlePath(...s.circle);
      else if (s.rect) d = rectPath(...s.rect);
      return `    <path
        android:pathData="${d}"
        android:fillColor="${argb(s.fill)}" />`;
    })
    .join("\n");
}

mkdirSync(OUT, { recursive: true });

// Les illustrations de la version précédente (pizza, burger, étoiles, scooter…)
// ne racontaient rien : elles décoraient. Elles sont retirées de l'APK, pas
// seulement du code — un drawable orphelin reste empaqueté.
const keep = new Set(Object.keys(ILLUS).map((k) => k + ".xml"));
for (const f of readdirSync(OUT)) {
  if (f.startsWith("ic_illu_") && !keep.has(f)) {
    unlinkSync(join(OUT, f));
    console.log(`${f} — supprimé (obsolète)`);
  }
}

for (const [name, shapes] of Object.entries(ILLUS)) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<!-- GÉNÉRÉ par scripts/coligo-illustrations.mjs — ne pas éditer à la main.
     Boîte 48×48, l'objet pose sur la ligne y=44 (le sol de la scène). -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="48dp"
    android:height="48dp"
    android:viewportWidth="48"
    android:viewportHeight="48">
${toXml(shapes)}
</vector>
`;
  writeFileSync(join(OUT, name + ".xml"), xml, "utf8");
  console.log(`${name}.xml — ${shapes.length} formes`);
}
