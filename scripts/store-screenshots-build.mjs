// store-screenshots-build — re-rend le panorama stores (9240×2868, 7 volets 1320×2868) avec les
// captures fraîches, puis décline chaque volet sur TOUTES les tailles
// iPhone/iPad ASC + tablettes Play.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const root = process.cwd();

// 1) Rendu des 7 volets natifs (1320×2868).
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 9240, height: 2868 },
  deviceScaleFactor: 1,
});
await page.goto(
  "file:///" + resolve(root, "store-assets/panorama.html").replace(/\\/g, "/")
);
await page.waitForTimeout(4500); // polices Google + images
for (let i = 0; i < 7; i++) {
  await page.screenshot({
    path: resolve(root, `store-assets/coligo_store_0${i + 1}.png`),
    clip: { x: i * 1320, y: 0, width: 1320, height: 2868 },
  });
  console.log("volet", i + 1, "rendu");
}
await browser.close();

// 2) Déclinaisons. Même ratio → resize cover ; ratio différent → « blur-pad »
//    (fond = le volet flouté en cover, volet entier contenu par-dessus).
const CLASSES = [
  // ASC iPhone
  ["asc/APP_IPHONE_67", 1290, 2796],
  ["asc/APP_IPHONE_65", 1284, 2778],
  ["asc/APP_IPHONE_61", 1179, 2556],
  ["asc/APP_IPHONE_58", 1125, 2436],
  ["asc/APP_IPHONE_55", 1242, 2208],
  ["asc/APP_IPHONE_47", 750, 1334],
  ["asc/APP_IPHONE_40", 640, 1136],
  ["asc/APP_IPHONE_35", 640, 960],
  // ASC iPad
  ["asc/APP_IPAD_PRO_3GEN_129", 2048, 2732],
  ["asc/APP_IPAD_PRO_129", 2048, 2732],
  ["asc/APP_IPAD_PRO_3GEN_11", 1668, 2388],
  ["asc/APP_IPAD_105", 1668, 2224],
  ["asc/APP_IPAD_97", 1536, 2048],
  // Play tablettes
  ["play-7", 1668, 2224],
  ["play-10", 2048, 2732],
];
const SRC_RATIO = 1320 / 2868;

for (const [dir, W, H] of CLASSES) {
  mkdirSync(resolve(root, "store-assets", dir), { recursive: true });
  for (let i = 1; i <= 7; i++) {
    const src = resolve(root, `store-assets/coligo_store_0${i}.png`);
    const out = resolve(root, `store-assets/${dir}/coligo_store_0${i}.png`);
    const ratio = W / H;
    if (Math.abs(ratio - SRC_RATIO) < 0.01) {
      await sharp(src)
        .resize(W, H, { fit: "cover" })
        .png({ compressionLevel: 9 })
        .toFile(out);
    } else {
      const bg = await sharp(src)
        .resize(W, H, { fit: "cover" })
        .blur(45)
        .modulate({ brightness: 0.82 })
        .toBuffer();
      const fgH = Math.round(H * 0.965);
      const fg = await sharp(src)
        .resize({ height: fgH, fit: "inside" })
        .png()
        .toBuffer();
      await sharp(bg)
        .composite([{ input: fg, gravity: "centre" }])
        .png({ compressionLevel: 9 })
        .toFile(out);
    }
  }
  console.log(dir, "ok (7 visuels", W + "x" + H + ")");
}
// iOS 6,7" : rafraîchit aussi l'ancien emplacement store-assets/ios/.
for (let i = 1; i <= 7; i++) {
  await sharp(resolve(root, `store-assets/coligo_store_0${i}.png`))
    .resize(1290, 2796, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toFile(resolve(root, `store-assets/ios/coligo_store_0${i}.png`));
}
console.log("ios/ rafraîchi");
