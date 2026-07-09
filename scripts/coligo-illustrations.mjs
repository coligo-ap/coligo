#!/usr/bin/env node
/**
 * Illustrations plates du CIRCUIT de l'écran de lancement natif.
 *
 *   node scripts/coligo-illustrations.mjs           # génère les VectorDrawable
 *   node scripts/coligo-illustrations.mjs --preview # + planche PNG de contrôle
 *
 * Pourquoi ici et pas dans un outil de design : ces illustrations vivent dans
 * l'APK sous forme de VectorDrawable (aucun bitmap, aucune dépendance, net à
 * toutes les densités). Le format XML d'Android n'accepte QUE des `<path>` —
 * pas de `<circle>`, pas de `<rect>`. Ce script est donc la source de vérité :
 * on décrit avec des primitives lisibles, il convertit.
 *
 * Style : aplats colorés, silhouette d'abord, façon filtres Uber Eats. Boîte
 * 48×48, l'objet POSE sur la ligne y=44 — c'est la route du circuit. Si tu
 * changes une illustration, garde ce pied, sinon elle flottera.
 *
 * Sortie : android/app/src/main/res/drawable/ic_illu_*.xml
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "android/app/src/main/res/drawable");

const P = {
  ink: "#2B2140",
  inkSoft: "#3E3160",
  white: "#FFFFFF",
  rose: "#FF2D7A",
  orange: "#FF6B4A",
  orangeDark: "#E2543A",
  amber: "#FFC53D",
  amberDark: "#F0A81E",
  cream: "#FFE7A8",
  sky: "#59C1FF",
  skyDark: "#3BA7EA",
  green: "#3DD68C",
  greenDark: "#22B573",
  kraft: "#D9A566",
  kraftDark: "#B8834A",
  skin: "#FFC9A3",
  cheese: "#FFD98A",
  crust: "#F0B45E",
  tomato: "#E23B4E",
};

/** Le parcours Coligo, dans l'ordre de l'histoire. */
export const ILLUS = {
  // Le commerçant prépare : fruits/plats, boissons, et emballe en sac kraft.
  ic_illu_pizza: [
    {
      d: "M24,7 L41,39 C41.6,40.2 40.8,41.5 39.5,41.3 L8.5,41.3 C7.2,41.5 6.4,40.2 7,39 Z",
      fill: P.crust,
    },
    { d: "M24,12 L37.5,38 L10.5,38 Z", fill: P.cheese },
    { circle: [24, 22, 2.6], fill: P.tomato },
    { circle: [18.5, 32, 2.6], fill: P.tomato },
    { circle: [29.5, 32, 2.6], fill: P.tomato },
    { circle: [24, 32, 1.6], fill: P.green },
  ],
  ic_illu_drink: [
    { d: "M31,7 L26.5,18", stroke: P.rose, w: 2.6 },
    { rect: [11, 14, 26, 4.6, 2.3], fill: P.rose },
    {
      d: "M13,18.6 L35,18.6 L32.2,42.4 C32.1,43.3 31.3,44 30.4,44 L17.6,44 C16.7,44 15.9,43.3 15.8,42.4 Z",
      fill: P.white,
    },
    { d: "M14.3,29 L33.7,29 L33,35 L15,35 Z", fill: P.sky },
  ],
  ic_illu_bag: [
    {
      d: "M18,14 C18,9.6 21.2,6.5 24,6.5 C26.8,6.5 30,9.6 30,14",
      stroke: P.kraftDark,
      w: 2.4,
    },
    {
      d: "M11,14 L37,14 L39,42 C39.1,43.2 38.2,44 37,44 L11,44 C9.8,44 8.9,43.2 9,42 Z",
      fill: P.kraft,
    },
    { d: "M11,14 L37,14 L37.4,19.5 L10.6,19.5 Z", fill: P.kraftDark },
    { d: "M20,14 C20,9.5 23,7 27,7 C27,11.5 24,14 20,14 Z", fill: P.green },
    { d: "M27,7 C25,9 23.5,11 22.5,14", stroke: P.greenDark, w: 1.1 },
  ],

  // Le livreur express. Silhouette de Vespa, tournée vers la droite. L'ordre des
  // formes fait la lecture : caisse → coque → marchepied → tablier → roues.
  ic_illu_scooter: [
    { rect: [2.5, 12.5, 10.5, 9.5, 2], fill: P.sky },
    { rect: [2.5, 16, 10.5, 1.8, 0.4], fill: P.skyDark },
    { rect: [4, 22, 8, 1.8, 0.9], fill: P.inkSoft },
    {
      d: "M8,34 C6.5,29 8,23.5 13.5,23 L23,23 C25.8,23 27,25.6 27,28.5 L27,34 Z",
      fill: P.orange,
    },
    { rect: [11.5, 19.6, 13, 4.2, 2.1], fill: P.ink },
    { d: "M20,31 L33,31 L33,34 L20,34 Z", fill: P.orangeDark },
    {
      d: "M30,34 L32.4,21.5 C32.7,19.9 34,18.8 35.6,18.8 L38.4,18.8 L36.4,34 Z",
      fill: P.orange,
    },
    {
      d: "M33.2,30.5 C35.5,29 38.6,29.2 40.6,31.2 L39.2,32.6 C37.8,31.2 35.6,31 34,32 Z",
      fill: P.orangeDark,
    },
    { d: "M36.5,19 L43,17.2", stroke: P.ink, w: 2.6 },
    { circle: [43.4, 17.1, 1.7], fill: P.inkSoft },
    { circle: [38.6, 21.6, 2.3], fill: P.cream },
    { circle: [14.5, 37, 6.3], fill: P.ink },
    { circle: [14.5, 37, 2.5], fill: P.white },
    { circle: [36.5, 37, 6.3], fill: P.ink },
    { circle: [36.5, 37, 2.5], fill: P.white },
  ],

  // Le client qui attend, la main levée.
  ic_illu_person: [
    { circle: [24, 12.5, 6], fill: P.skin },
    {
      d: "M18,11.5 C18,7 20.8,4.5 24,4.5 C27.2,4.5 30,7 30,11.5 C28,9.5 26,9 24,9 C22,9 20,9.5 18,11.5 Z",
      fill: P.ink,
    },
    {
      d: "M13,44 L13,30 C13,24.5 17.5,20.5 24,20.5 C30.5,20.5 35,24.5 35,30 L35,44 Z",
      fill: P.rose,
    },
    { d: "M35,29 L40,21", stroke: P.skin, w: 3.4 },
    { circle: [40.5, 19.5, 2.2], fill: P.skin },
    { d: "M20.5,21.5 C21.5,24 26.5,24 27.5,21.5", stroke: P.white, w: 1.6 },
  ],

  // Coligo Drive.
  ic_illu_car: [
    {
      d: "M13,25 L16.5,16.5 C17,15.2 18.2,14.5 19.6,14.5 L30,14.5 C31.4,14.5 32.6,15.3 33.2,16.5 L37,25 Z",
      fill: P.amber,
    },
    {
      d: "M17,23.5 L19.4,17.6 C19.6,17.1 20,16.8 20.5,16.8 L24,16.8 L24,23.5 Z",
      fill: P.sky,
    },
    {
      d: "M26,16.8 L29.6,16.8 C30.1,16.8 30.5,17.1 30.7,17.6 L33,23.5 L26,23.5 Z",
      fill: P.sky,
    },
    {
      d: "M6,32 C6,27.5 8.5,25 13,25 L37,25 C41,25 44,27.5 44,32 L44,35 C44,36 43.2,36.5 42.2,36.5 L7.8,36.5 C6.8,36.5 6,36 6,35 Z",
      fill: P.amberDark,
    },
    { rect: [6, 29.5, 38, 3, 1.2], fill: P.amber },
    { circle: [41.5, 30.5, 1.8], fill: P.cream },
    { circle: [8.5, 30.5, 1.6], fill: P.tomato },
    { circle: [14, 37, 5.6], fill: P.ink },
    { circle: [14, 37, 2.2], fill: P.white },
    { circle: [35, 37, 5.6], fill: P.ink },
    { circle: [35, 37, 2.2], fill: P.white },
  ],

  // La récompense.
  ic_illu_cashback: [
    { circle: [24, 26, 15], fill: P.amberDark },
    { circle: [24, 24, 15], fill: P.amber },
    { circle: [24, 24, 11], fill: P.cream },
    { circle: [19.5, 19.5, 2.6], fill: P.amberDark },
    { circle: [28.5, 28.5, 2.6], fill: P.amberDark },
    { d: "M30,17 L18,31", stroke: P.amberDark, w: 2.6 },
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
for (const [name, shapes] of Object.entries(ILLUS)) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<!-- GÉNÉRÉ par scripts/coligo-illustrations.mjs — ne pas éditer à la main.
     Boîte 48×48, l'objet pose sur la ligne y=44 (la route du circuit). -->
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
