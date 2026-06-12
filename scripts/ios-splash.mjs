#!/usr/bin/env node
/**
 * Génère les splash screens iOS pour la PWA installée.
 *
 * Apple exige une image par combinaison (device-width, device-height,
 * pixel-ratio, orientation) — on couvre les iPhone usuels (SE → 15 Pro Max).
 *
 *   node scripts/ios-splash.mjs
 *
 * Sortie : public/ios-splash/*.png + console.log du JSX <link> à coller dans
 *          app/layout.tsx (juste pour vérifier après changement, le JSX est
 *          déjà commit côté layout).
 */

import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "ios-splash");
const ICON_SRC = join(ROOT, "public", "brand", "logo-full-white.png");
const BRAND = { r: 0x6c, g: 0x2b, b: 0xd9, alpha: 1 };

// (deviceW, deviceH, ratio) → tailles physiques portrait (W×H) et landscape (H×W).
const DEVICES = [
  { name: "se", w: 375, h: 667, r: 2 },
  { name: "8plus", w: 414, h: 736, r: 3 },
  { name: "x", w: 375, h: 812, r: 3 },
  { name: "xr-11", w: 414, h: 896, r: 2 },
  { name: "xsmax-11pm", w: 414, h: 896, r: 3 },
  { name: "12-13-14", w: 390, h: 844, r: 3 },
  { name: "14plus-13pm", w: 428, h: 926, r: 3 },
  { name: "14pro-15", w: 393, h: 852, r: 3 },
  { name: "15pm-14pm", w: 430, h: 932, r: 3 },
];

async function makeSplash(filePath, width, height) {
  const innerSize = Math.round(Math.min(width, height) * 0.55);
  const iconBuf = await sharp(ICON_SRC)
    .resize(innerSize, innerSize, { fit: "inside" })
    .png()
    .toBuffer();
  const meta = await sharp(iconBuf).metadata();
  await sharp({
    create: { width, height, channels: 4, background: BRAND },
  })
    .composite([
      {
        input: iconBuf,
        top: Math.round((height - meta.height) / 2),
        left: Math.round((width - meta.width) / 2),
      },
    ])
    .png()
    .toFile(filePath);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const links = [];
  for (const d of DEVICES) {
    const portraitW = d.w * d.r;
    const portraitH = d.h * d.r;
    const landscapeW = portraitH;
    const landscapeH = portraitW;

    const portraitFile = `${d.name}-portrait.png`;
    const landscapeFile = `${d.name}-landscape.png`;

    await makeSplash(join(OUT, portraitFile), portraitW, portraitH);
    await makeSplash(join(OUT, landscapeFile), landscapeW, landscapeH);

    const mediaBase =
      `(device-width: ${d.w}px) and (device-height: ${d.h}px) ` +
      `and (-webkit-device-pixel-ratio: ${d.r})`;
    links.push(
      `<link rel="apple-touch-startup-image" media='${mediaBase} and (orientation: portrait)' href="/ios-splash/${portraitFile}" />`
    );
    links.push(
      `<link rel="apple-touch-startup-image" media='${mediaBase} and (orientation: landscape)' href="/ios-splash/${landscapeFile}" />`
    );
  }
  console.log("iOS splash screens generated in public/ios-splash/.");
  console.log("Tags pour app/layout.tsx (déjà committés) :\n");
  console.log(links.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
