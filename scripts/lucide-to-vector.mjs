import fs from "node:fs";
import path from "node:path";

const ROOT = "C:/Users/gaci/Desktop/noti/dz/coligo-v3-violet/coligo";
const OUT = path.join(ROOT, "android/app/src/main/res/drawable");
const ICONS = {
  ic_intro_bike: "bike",
  ic_intro_car: "car",
  ic_intro_person: "user-round",
  ic_intro_bag: "shopping-bag",
  ic_intro_apple: "apple",
  ic_intro_drink: "cup-soda",
  ic_intro_coin: "coins",
};

/** Convertit une forme lucide (JSON node) en `d` SVG. */
function toPathData(tag, a) {
  const n = (k) => Number(a[k]);
  if (tag === "path") return a.d;
  if (tag === "circle") {
    const [cx, cy, r] = [n("cx"), n("cy"), n("r")];
    return `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`;
  }
  if (tag === "ellipse") {
    const [cx, cy, rx, ry] = [n("cx"), n("cy"), n("rx"), n("ry")];
    return `M${cx - rx},${cy} a${rx},${ry} 0 1,0 ${2 * rx},0 a${rx},${ry} 0 1,0 ${-2 * rx},0`;
  }
  if (tag === "line") return `M${a.x1},${a.y1} L${a.x2},${a.y2}`;
  if (tag === "rect") {
    const [x, y, w, h] = [n("x"), n("y"), n("width"), n("height")];
    return `M${x},${y} h${w} v${h} h${-w} z`;
  }
  if (tag === "polyline" || tag === "polygon") {
    const pts = a.points.trim().split(/\s+/);
    return "M" + pts.join(" L") + (tag === "polygon" ? " z" : "");
  }
  return null;
}

/** Les fichiers lucide-react déclarent : const __iconNode = [ [tag, {..}], ... ] */
function parseIcon(name) {
  const src = fs.readFileSync(
    path.join(ROOT, "node_modules/lucide-react/dist/esm/icons", name + ".js"),
    "utf8"
  );
  const start = src.indexOf("[");
  const end = src.lastIndexOf("]");
  const body = src.slice(start, end + 1);
  // Le tableau est du JS quasi-JSON : clés non quotées possibles.
   
  const nodes = new Function("return " + body)();
  const out = [];
  for (const item of nodes) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const [tag, attrs] = item;
    if (typeof tag !== "string" || typeof attrs !== "object") continue;
    const d = toPathData(tag, attrs);
    if (d) out.push(d);
  }
  return out;
}

fs.mkdirSync(OUT, { recursive: true });
for (const [file, icon] of Object.entries(ICONS)) {
  const paths = parseIcon(icon);
  if (!paths.length) {
    console.log("!! aucun tracé pour", icon);
    continue;
  }
  const body = paths
    .map(
      (d) =>
        `    <path\n        android:pathData="${d}"\n        android:strokeColor="#FFFFFFFF"\n        android:strokeWidth="1.9"\n        android:strokeLineCap="round"\n        android:strokeLineJoin="round" />`
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<!-- Généré depuis lucide-react (${icon}). Ne pas éditer à la main :
     régénérer avec scripts/lucide-to-vector.mjs si l'icône change. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
${body}
</vector>
`;
  fs.writeFileSync(path.join(OUT, file + ".xml"), xml, "utf8");
  console.log(file + ".xml —", paths.length, "tracés");
}
