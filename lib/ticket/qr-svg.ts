// `import type` = effacé à la compilation → ne bundle PAS zxing, sert juste à
// typer la Map de hints. Les valeurs runtime arrivent par import dynamique.
import type { EncodeHintType as EncodeHintTypeEnum } from "@zxing/library";

/**
 * Génère un QR au format SVG (chaîne) SANS DOM — utilisable aussi bien côté
 * serveur (route `/print/orders/[id]`) que côté client (aperçu, capture
 * bitmap). On encode en passant `width=height=0` à zxing : il renvoie alors la
 * matrice BRUTE (1 cellule = 1 module QR) + sa quiet-zone. Chaque module = un
 * carré noir ; on fusionne les runs horizontaux par ligne pour garder un SVG
 * compact.
 *
 * `value` doit rester COURT (référence de commande, pas une URL longue) : QR de
 * version basse → modules plus gros → scan fiable sur papier thermique 80 mm.
 *
 * Le SVG n'a pas de dimensions fixes : il est mis à l'échelle par le CSS du
 * conteneur (`.qr-wrap svg { width: … }`). `shape-rendering: crispEdges`
 * garantit des bords nets sans antialiasing (essentiel en thermique).
 *
 * `@zxing/library` est chargé en IMPORT DYNAMIQUE : ~110 Ko qu'on ne veut pas
 * embarquer dans le bundle initial des pages commerçant (liste commandes,
 * réglages). La lib n'est chargée qu'au moment réel d'un build de ticket
 * (impression / aperçu).
 */
export async function qrSvg(
  value: string,
  opts?: { margin?: number }
): Promise<string> {
  const { MultiFormatWriter, BarcodeFormat, EncodeHintType } =
    await import("@zxing/library");
  const hints = new Map<EncodeHintTypeEnum, number>();
  hints.set(EncodeHintType.MARGIN, opts?.margin ?? 2);

  const matrix = new MultiFormatWriter().encode(
    value,
    BarcodeFormat.QR_CODE,
    0,
    0,
    hints
  );

  const w = matrix.getWidth();
  const h = matrix.getHeight();
  const rects: string[] = [];
  for (let y = 0; y < h; y++) {
    let runStart = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && matrix.get(x, y);
      if (on && runStart < 0) {
        runStart = x;
      } else if (!on && runStart >= 0) {
        rects.push(
          `<rect x="${runStart}" y="${y}" width="${x - runStart}" height="1"/>`
        );
        runStart = -1;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" fill="#000">${rects.join(
    ""
  )}</svg>`;
}
