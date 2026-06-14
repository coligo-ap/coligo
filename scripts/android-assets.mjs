#!/usr/bin/env node
/**
 * Génère les ressources Android (icônes launcher + splash) à partir de
 * `public/icon-maskable-512.png` et de la couleur de marque #5C5CE0.
 *
 * À relancer après chaque changement d'icône source ou de couleur.
 *
 *   node scripts/android-assets.mjs
 */

import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ANDROID_RES = join(ROOT, "android", "app", "src", "main", "res");
const VALUES = join(ANDROID_RES, "values");

// Icône de l'APK. Par défaut = logo COMMERCE (app commerçant). Paramétrable
// par env pour générer les autres apps (livreur / chauffeur Drive) :
//   COLIGO_ICON_LOGO=logo-coligo-livreur-app.png node scripts/android-assets.mjs
// Tous les logos ont le fond violet #6C2BD9 → l'icône adaptative se fond bien.
const ICON_SRC = join(
  ROOT,
  "public",
  process.env.COLIGO_ICON_LOGO || "logo-coligo-commerce-app.png"
);
const BRAND_HEX = process.env.COLIGO_BRAND_HEX || "#6C2BD9";
const BRAND = {
  r: parseInt(BRAND_HEX.slice(1, 3), 16),
  g: parseInt(BRAND_HEX.slice(3, 5), 16),
  b: parseInt(BRAND_HEX.slice(5, 7), 16),
};

// Tailles standard Android — mipmap-* (lanceur classique).
const LAUNCHER = {
  "mipmap-mdpi": 48,
  "mipmap-hdpi": 72,
  "mipmap-xhdpi": 96,
  "mipmap-xxhdpi": 144,
  "mipmap-xxxhdpi": 192,
};

// Adaptive icon foreground : 108dp total, contenu safe-zone ≈ 66dp.
// Android crop le bord pendant les animations — on garde du padding.
const FOREGROUND = {
  "mipmap-mdpi": 108,
  "mipmap-hdpi": 162,
  "mipmap-xhdpi": 216,
  "mipmap-xxhdpi": 324,
  "mipmap-xxxhdpi": 432,
};

// Splash : dimensions portrait + landscape par densité.
const SPLASH_PORT = {
  "drawable-port-mdpi": [320, 480],
  "drawable-port-hdpi": [480, 800],
  "drawable-port-xhdpi": [720, 1280],
  "drawable-port-xxhdpi": [960, 1600],
  "drawable-port-xxxhdpi": [1280, 1920],
};
const SPLASH_LAND = {
  "drawable-land-mdpi": [480, 320],
  "drawable-land-hdpi": [800, 480],
  "drawable-land-xhdpi": [1280, 720],
  "drawable-land-xxhdpi": [1600, 960],
  "drawable-land-xxxhdpi": [1920, 1280],
};

async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}

async function writeIcon(filePath, size) {
  await sharp(ICON_SRC)
    .resize(size, size, { fit: "contain" })
    .png()
    .toFile(filePath);
}

async function writeForeground(filePath, size) {
  // Icône centrée dans un canvas transparent — Android compose le background
  // (la couleur de marque) en dessous.
  const inner = Math.round(size * 0.66);
  const padding = Math.round((size - inner) / 2);
  const iconBuf = await sharp(ICON_SRC)
    .resize(inner, inner, { fit: "contain" })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: iconBuf, top: padding, left: padding }])
    .png()
    .toFile(filePath);
}

async function writeSplash(filePath, width, height) {
  // Logo central : ~30% du plus petit côté.
  const innerSize = Math.round(Math.min(width, height) * 0.3);
  const iconBuf = await sharp(ICON_SRC)
    .resize(innerSize, innerSize, { fit: "contain" })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: BRAND.r, g: BRAND.g, b: BRAND.b, alpha: 1 },
    },
  })
    .composite([
      {
        input: iconBuf,
        top: Math.round((height - innerSize) / 2),
        left: Math.round((width - innerSize) / 2),
      },
    ])
    .png()
    .toFile(filePath);
}

async function main() {
  // 1. Couleurs partagées + couleur de fond du launcher adaptatif.
  await ensureDir(VALUES);
  await writeFile(
    join(VALUES, "colors.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">${BRAND_HEX}</color>
    <color name="colorPrimaryDark">#4B1FA6</color>
    <color name="colorAccent">${BRAND_HEX}</color>
</resources>
`,
    "utf8"
  );
  await writeFile(
    join(VALUES, "ic_launcher_background.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BRAND_HEX}</color>
</resources>
`,
    "utf8"
  );

  // 2. Icônes lanceur (carrée + ronde — Android choisit selon le launcher).
  for (const [folder, size] of Object.entries(LAUNCHER)) {
    const dir = join(ANDROID_RES, folder);
    await ensureDir(dir);
    await writeIcon(join(dir, "ic_launcher.png"), size);
    await writeIcon(join(dir, "ic_launcher_round.png"), size);
  }

  // 3. Foreground adaptatif (Android 8+).
  for (const [folder, size] of Object.entries(FOREGROUND)) {
    const dir = join(ANDROID_RES, folder);
    await ensureDir(dir);
    await writeForeground(join(dir, "ic_launcher_foreground.png"), size);
  }

  // 4. Splash : portrait + landscape, toutes densités, + version par défaut.
  for (const [folder, [w, h]] of Object.entries(SPLASH_PORT)) {
    const dir = join(ANDROID_RES, folder);
    await ensureDir(dir);
    await writeSplash(join(dir, "splash.png"), w, h);
  }
  for (const [folder, [w, h]] of Object.entries(SPLASH_LAND)) {
    const dir = join(ANDROID_RES, folder);
    await ensureDir(dir);
    await writeSplash(join(dir, "splash.png"), w, h);
  }
  // Splash par défaut (sans qualifier de densité).
  await writeSplash(join(ANDROID_RES, "drawable", "splash.png"), 1280, 1920);

  console.log("Android assets generated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
