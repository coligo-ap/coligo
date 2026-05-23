// Génère les icônes PWA en PNG (violet #5C5CE0 + lettre C blanche stylisée).
// Aucune dépendance externe : on encode le PNG à la main avec `zlib`.
//
// Usage : `node scripts/generate-pwa-icons.mjs`
// Sortie : public/icon-192.png, icon-512.png, icon-maskable-512.png,
//          apple-touch-icon.png (180), favicon-32.png.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "..", "public");

// Violet primaire et blanc — couleur de marque Coligo.
const VIOLET = [0x5c, 0x5c, 0xe0, 0xff];
const WHITE = [0xff, 0xff, 0xff, 0xff];

/**
 * Compose une icône RGBA carrée : fond violet + lettre « C » blanche stylisée
 * (anneau à droite ouvert). `padRatio` ajoute une zone de sécurité pour les
 * versions « maskable » (≥ 20%).
 */
function drawIcon(size, padRatio = 0) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const usable = size * (1 - padRatio * 2);
  const outer = usable * 0.42;
  const inner = usable * 0.3;
  // Ouverture droite de la lettre C : largeur (x) et hauteur (y) du « trou ».
  const cutX = usable * 0.05;
  const cutY = usable * 0.2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      const inRing = r <= outer && r >= inner;
      const inCut = dx > cutX && Math.abs(dy) < cutY;
      const isLetter = inRing && !inCut;
      const i = (y * size + x) * 4;
      const c = isLetter ? WHITE : VIOLET;
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
      buf[i + 3] = c[3];
    }
  }
  return buf;
}

/**
 * Encode un buffer RGBA brut en PNG (color type 6 = truecolor + alpha).
 * On ajoute un octet de filtre (0 = none) au début de chaque ligne avant
 * compression zlib, comme l'exige le format PNG.
 */
function encodePNG(rgba, size) {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT : pixels filtrés (filter byte 0 par ligne) puis deflate.
  const rowLen = size * 4;
  const raw = Buffer.alloc(size * (rowLen + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (rowLen + 1)] = 0;
    rgba.copy(raw, y * (rowLen + 1) + 1, y * rowLen, (y + 1) * rowLen);
  }
  const idat = deflateSync(raw, { level: 9 });

  function chunk(type, data) {
    const typeBuf = Buffer.from(type, "ascii");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([length, typeBuf, data, crc]);
  }

  return Buffer.concat([
    header,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function writeIcon(name, size, padRatio = 0) {
  const rgba = drawIcon(size, padRatio);
  const png = encodePNG(rgba, size);
  await writeFile(resolve(PUBLIC_DIR, name), png);
  console.log(
    `✓ ${name} (${size}×${size}${padRatio ? `, pad ${padRatio * 100}%` : ""})`
  );
}

async function main() {
  await mkdir(PUBLIC_DIR, { recursive: true });
  await writeIcon("icon-192.png", 192);
  await writeIcon("icon-512.png", 512);
  // Padding ≥ 20% pour la safe-zone des icônes maskable (Android adaptive icons).
  await writeIcon("icon-maskable-512.png", 512, 0.22);
  await writeIcon("apple-touch-icon.png", 180);
  await writeIcon("favicon-32.png", 32);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
