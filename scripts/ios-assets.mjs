#!/usr/bin/env node
/**
 * Génère l'icône App Store et l'écran de lancement iOS de l'app CLIENT à
 * partir de `public/icons/client-maskable-512.png` (même source que
 * l'icône Android client — cf. scripts/build-client-aab.mjs) et de la
 * couleur de marque #47168B.
 *
 * À relancer après changement de l'icône source ou de la couleur :
 *   node scripts/ios-assets.mjs
 */

import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ICON_SRC = join(ROOT, "public", "icons", "client-maskable-512.png");
const BRAND_HEX = "#47168B";
const BRAND = {
  r: parseInt(BRAND_HEX.slice(1, 3), 16),
  g: parseInt(BRAND_HEX.slice(3, 5), 16),
  b: parseInt(BRAND_HEX.slice(5, 7), 16),
};

const ASSETS = join(ROOT, "ios", "App", "App", "Assets.xcassets");

async function writeAppIcon() {
  // Xcode 14+ : un seul slot 1024x1024 (Contents.json "universal"/"1024x1024").
  // Pas de canal alpha accepté par App Store Connect → flatten sur fond marque
  // (la source est "fullbleed" comme l'icône Android client, cf.
  // COLIGO_ICON_FULLBLEED dans android-assets.mjs).
  await sharp(ICON_SRC)
    .resize(1024, 1024, { fit: "cover" })
    .flatten({ background: BRAND })
    .png()
    .toFile(join(ASSETS, "AppIcon.appiconset", "AppIcon-512@2x.png"));
}

async function writeSplash() {
  const SIZE = 2732;
  const innerSize = Math.round(SIZE * 0.3);
  const iconBuf = await sharp(ICON_SRC)
    .resize(innerSize, innerSize, { fit: "contain" })
    .png()
    .toBuffer();
  const buf = await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { ...BRAND, alpha: 1 },
    },
  })
    .composite([
      {
        input: iconBuf,
        top: Math.round((SIZE - innerSize) / 2),
        left: Math.round((SIZE - innerSize) / 2),
      },
    ])
    .png()
    .toBuffer();

  const dir = join(ASSETS, "Splash.imageset");
  // Les 3 scales (1x/2x/3x) partagent le même canvas universel — convention
  // du gabarit Capacitor par défaut (cf. Splash.imageset/Contents.json).
  await Promise.all([
    writeFile(join(dir, "splash-2732x2732.png"), buf),
    writeFile(join(dir, "splash-2732x2732-1.png"), buf),
    writeFile(join(dir, "splash-2732x2732-2.png"), buf),
  ]);
}

async function main() {
  await writeAppIcon();
  await writeSplash();
  console.log(
    "iOS assets generated (AppIcon + Splash, brand " + BRAND_HEX + ")."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
