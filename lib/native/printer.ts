/**
 * Impression de tickets.
 *
 * Aujourd'hui : iframe isolée + `window.print()` (dialogue système, marche
 * partout — Chrome/Firefox/Edge/Safari, desktop & mobile).
 *
 * APK Sunmi/Imin avec imprimante thermique intégrée : à brancher dans
 * `lib/native/printer.native.ts` (SDK natif, impression directe sans dialogue)
 * et exporter via une bascule dans `index.ts`. Le code appelant ne change pas.
 */

export type PrintOptions = {
  /** HTML complet à injecter dans le ticket (sans <html>/<body> requis). */
  html: string;
  /** Largeur papier en mm (80 par défaut pour les rouleaux thermiques). */
  widthMm?: number;
  /** Titre éphémère de la fenêtre d'impression. */
  title?: string;
};

export async function printTicket({
  html,
  widthMm = 80,
  title = "Ticket Coligo",
}: PrintOptions): Promise<void> {
  if (typeof document === "undefined") return;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  // On la garde dans le flux mais invisible : certains navigateurs
  // (Safari iOS) refusent d'imprimer un iframe `display:none`.
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${widthMm}mm;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 12px;
    color: #000;
    padding: 4mm;
  }
  * { box-sizing: border-box; }
</style>
</head>
<body>${html}</body>
</html>`);
  doc.close();

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    // `afterprint` est l'API correcte mais peu fiable (Chrome) → fallback timeout.
    win.addEventListener("afterprint", finish, { once: true });
    window.setTimeout(finish, 5_000);

    const trigger = () => {
      try {
        win.focus();
        win.print();
      } catch {
        finish();
      }
    };
    if (doc.readyState === "complete") trigger();
    else iframe.addEventListener("load", trigger, { once: true });
  });

  iframe.remove();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
