#!/usr/bin/env node
/**
 * Génère TOUS les assets de marque Coligo à partir des logos sources
 * déposés dans public/ (logo-coligo-*.png) :
 *
 *  - public/brand/*               logos web optimisés (violet + blanc, FR/AR/complet) + icône "C"
 *  - public/favicon-32.png, favicon.ico, icon-192/512, icon-maskable-512, apple-touch-icon
 *  - public/og-image.png          partage réseaux sociaux (1200×630)
 *  - android res/                 ic_launcher(+round/foreground) toutes densités + splash.png
 *
 *   node scripts/brand-assets.mjs
 *
 * Après exécution : relancer `node scripts/ios-splash.mjs` (splash PWA iOS).
 */

import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUB = join(ROOT, "public");
const BRAND_DIR = join(PUB, "brand");
const RES = join(ROOT, "android", "app", "src", "main", "res");

const VIOLET = { r: 0x6c, g: 0x2b, b: 0xd9, alpha: 1 };
const GRADIENT = ["#5B2EFF", "#6C2BD9"];

const SRC = {
  fr: join(PUB, "logo-coligo-FR-Bg_blanc-Ecr_Violet.png"),
  ar: join(PUB, "logo-coligo-AR-Bg_blanc-Ecr_Violet.png"),
  full: join(PUB, "logo-coligo-FRAR-complet-Bg_blanc-Ecr_Violet.png"),
  // ICÔNE D'APP v2 (août 2026) : visuel carré COMPLET fourni par le
  // propriétaire (fond violet, wordmark + illustrations) — remplace l'ancien
  // « C » extrait pour TOUTES les icônes d'application (PWA, favicons,
  // launcher Android, App Store / Play Store).
  appViolet: join(PUB, "logo-app-coligo-v2-violet.png"),
};

/** Tous les pixels non transparents → blanc (garde l'alpha). */
async function whiten(buf) {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

/** Tous les pixels non transparents → noir (tickets thermiques, encre noire). */
async function blacken(buf) {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

async function trimmed(src) {
  return sharp(src).trim().toBuffer();
}

/** Compose un visuel `mark` centré sur fond violet uni. ratio = part de la dimension limitante. */
async function onViolet(
  markBuf,
  width,
  height,
  ratio,
  { gradient = false } = {}
) {
  const meta = await sharp(markBuf).metadata();
  const landscapeMark = meta.width >= meta.height;
  // contain dans une boîte ratio*W × ratio*H
  const boxW = Math.round(width * ratio);
  const boxH = Math.round(height * ratio);
  const mark = await sharp(markBuf)
    .resize(boxW, boxH, { fit: "inside" })
    .png()
    .toBuffer();
  const m = await sharp(mark).metadata();
  const bg = gradient
    ? await sharp(
        Buffer.from(
          `<svg width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${GRADIENT[0]}"/><stop offset="1" stop-color="${GRADIENT[1]}"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/></svg>`
        )
      )
        .png()
        .toBuffer()
    : await sharp({
        create: { width, height, channels: 4, background: VIOLET },
      })
        .png()
        .toBuffer();
  void landscapeMark;
  return sharp(bg)
    .composite([
      {
        input: mark,
        top: Math.round((height - m.height) / 2),
        left: Math.round((width - m.width) / 2),
      },
    ])
    .png();
}

/** ICO container avec entrées PNG (valide depuis Vista). */
function buildIco(pngs /* [{size, buf}] */) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type icon
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + 16 * count;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}

async function main() {
  await mkdir(BRAND_DIR, { recursive: true });

  // ── 1. Logos web (trim + redimension) ────────────────────────────────
  const frT = await trimmed(SRC.fr);
  const arT = await trimmed(SRC.ar);
  const fullT = await trimmed(SRC.full);

  const save = (buf, name, width) =>
    sharp(buf)
      .resize({ width, withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toFile(join(BRAND_DIR, name));

  await save(frT, "logo-fr.png", 800);
  await save(await whiten(frT), "logo-fr-white.png", 800);
  await save(arT, "logo-ar.png", 800);
  await save(await whiten(arT), "logo-ar-white.png", 800);
  await save(fullT, "logo-full.png", 1000);
  await save(await whiten(fullT), "logo-full-white.png", 1000);
  // Version NOIRE pour l'impression des tickets (thermique = encre noire).
  await save(await blacken(fullT), "logo-print.png", 600);

  // ── 2. Icône "C" (extraite du wordmark FR) ───────────────────────────
  const frMeta = await sharp(frT).metadata();
  const cBuf = await sharp(frT)
    .extract({
      left: 0,
      top: 0,
      width: Math.round(frMeta.width * 0.185),
      height: frMeta.height,
    })
    .trim()
    .toBuffer();
  const cWhite = await whiten(cBuf);
  await save(cBuf, "icon-c.png", 512);
  await save(cWhite, "icon-c-white.png", 512);

  // ── 3. Favicons / PWA — icône d'app v2 PLEINE SURFACE (le visuel carré
  //       porte déjà son fond violet ; le wordmark central reste dans la zone
  //       sûre des masques adaptatifs/maskable). Aplatie (pas d'alpha).
  const appIcon = (size) =>
    sharp(SRC.appViolet)
      .resize(size, size, { fit: "cover" })
      .flatten({ background: VIOLET })
      .png({ compressionLevel: 9 });
  await appIcon(512).toFile(join(PUB, "icon-512.png"));
  await appIcon(192).toFile(join(PUB, "icon-192.png"));
  await appIcon(512).toFile(join(PUB, "icon-maskable-512.png"));
  await appIcon(180).toFile(join(PUB, "apple-touch-icon.png"));
  await appIcon(32).toFile(join(PUB, "favicon-32.png"));

  const icoPngs = [];
  for (const size of [16, 32, 48]) {
    icoPngs.push({ size, buf: await appIcon(size).toBuffer() });
  }
  await writeFile(join(PUB, "favicon.ico"), buildIco(icoPngs));

  // ── 4. OG image (partages sociaux) ───────────────────────────────────
  await (
    await onViolet(await whiten(fullT), 1200, 630, 0.55, { gradient: true })
  ).toFile(join(PUB, "og-image.png"));

  // ── 5. Android : launcher icons ──────────────────────────────────────
  const densities = [
    ["mdpi", 48, 108],
    ["hdpi", 72, 162],
    ["xhdpi", 96, 216],
    ["xxhdpi", 144, 324],
    ["xxxhdpi", 192, 432],
  ];
  for (const [d, launcher, fg] of densities) {
    const dir = join(RES, `mipmap-${d}`);
    await appIcon(launcher).toFile(join(dir, "ic_launcher.png"));
    await appIcon(launcher).toFile(join(dir, "ic_launcher_round.png"));
    // Foreground adaptive : le visuel v2 couvre TOUT le canvas 108 dp — le
    // masque du launcher rogne les décors de coins, le wordmark central reste
    // dans la zone sûre (66 dp). Le background (violet) est ainsi recouvert.
    await appIcon(fg).toFile(join(dir, "ic_launcher_foreground.png"));
  }

  // ── 5 bis. iOS : icône App Store (universelle 1024, OPAQUE obligatoire) ─
  const iosIcon = join(
    ROOT,
    "ios",
    "App",
    "App",
    "Assets.xcassets",
    "AppIcon.appiconset",
    "AppIcon-512@2x.png"
  );
  await appIcon(1024).toFile(iosIcon);

  // ── 6. Android : splash screens (mêmes dimensions que l'existant) ────
  const splashTargets = [
    "drawable",
    "drawable-land-mdpi",
    "drawable-land-hdpi",
    "drawable-land-xhdpi",
    "drawable-land-xxhdpi",
    "drawable-land-xxxhdpi",
    "drawable-port-mdpi",
    "drawable-port-hdpi",
    "drawable-port-xhdpi",
    "drawable-port-xxhdpi",
    "drawable-port-xxxhdpi",
  ];
  const fullWhite = await whiten(fullT);
  for (const t of splashTargets) {
    const file = join(RES, t, "splash.png");
    const meta = await sharp(file).metadata();
    await (
      await onViolet(fullWhite, meta.width, meta.height, 0.45)
    ).toFile(file + ".new");
  }
  // remplace après coup (sharp ne peut pas écrire sur le fichier qu'il lit)
  const { rename } = await import("node:fs/promises");
  for (const t of splashTargets) {
    const file = join(RES, t, "splash.png");
    await rename(file + ".new", file);
  }

  console.log("Assets de marque générés (web + PWA + Android).");
  console.log("→ Relancer : node scripts/ios-splash.mjs");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
