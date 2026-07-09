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
 * changes une illustration, garde ce pied, sinon elle flottera. Pour la voiture,
 * la ligne y=44 est le bas des pneus.
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

export const ILLUS = {
  // ---------------------------------------------------------------- la voiture
  /**
   * Berline électrique VUE DE DESSUS, nez vers la DROITE — silhouette de Model 3 :
   * museau tronqué sans calandre, épaules pleines, toit de verre entre deux
   * lunettes.
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
  ic_illu_car_top: [
    // Caisse longue : 41 unités sur 16, soit un rapport 2,6. À 2,0 — la version
    // précédente — une voiture vue de dessus n'est plus une voiture, c'est un
    // galet.
    {
      d:
        "M4.4,24 C4.4,20.6 5.6,18.2 8.2,17.2 " +
        "C14.4,15.6 32.6,15.6 38.4,17.6 " +
        "C43.0,19.2 45.4,21.0 45.6,24 " +
        "C45.4,27.0 43.0,28.8 38.4,30.4 " +
        "C32.6,32.4 14.4,32.4 8.2,30.8 " +
        "C5.6,29.8 4.4,27.4 4.4,24 Z",
      fill: P.violet,
    },
    { rect: [30.4, 14.6, 3.2, 1.9, 0.9], fill: P.violetD },
    { rect: [30.4, 31.5, 3.2, 1.9, 0.9], fill: P.violetD },
    // LE toit de verre d'un bout à l'autre — la signature de la Model 3, et la
    // seule masse qui distingue une voiture vue de dessus d'une savonnette. En
    // deux lunettes séparées par un pavillon violet foncé, la nuance
    // disparaissait à 26 px de large : on ne lisait qu'une bande claire. Il
    // laisse un capot devant et un coffre derrière : sans eux, la voiture n'a
    // plus de sens de marche.
    {
      d:
        "M15.2,19.6 C19.6,18.4 28.6,18.4 32.4,19.6 " +
        "C33.8,20.2 34.4,21.8 34.5,24 " +
        "C34.4,26.2 33.8,27.8 32.4,28.4 " +
        "C28.6,29.6 19.6,29.6 15.2,28.4 " +
        "C14.0,27.9 13.5,26.2 13.5,24 " +
        "C13.5,21.8 14.0,20.1 15.2,19.6 Z",
      fill: P.tint,
    },
    { rect: [23.8, 18.9, 1.3, 10.2, 0.5], fill: P.violet },
    { rect: [42.0, 20.4, 2.4, 2.3, 1.0], fill: P.lamp },
    { rect: [42.0, 25.3, 2.4, 2.3, 1.0], fill: P.lamp },
    { rect: [5.4, 20.6, 2.2, 2.2, 1.0], fill: P.rose },
    { rect: [5.4, 25.2, 2.2, 2.2, 1.0], fill: P.rose },
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
