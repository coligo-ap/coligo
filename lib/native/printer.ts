/**
 * Impression de tickets.
 *
 * Aujourd'hui : on monte le ticket DANS le document principal puis on appelle
 * `window.print()`. Une feuille de style `@media print` injectée en même
 * temps masque TOUT le reste de la page (`body > *:not(#mount)`) et impose le
 * `@page { size: <width>mm auto; margin: 0 }`. Ainsi seul le ticket sort à
 * l'impression — pas de « capture d'écran » de l'app en page 1.
 *
 * Pourquoi pas un iframe : Chrome remonte parfois `print()` au document
 * parent, ce qui imprime l'app derrière le ticket. La technique « hide
 * everything except the mount » est la seule fiable cross-browser.
 *
 * APK Sunmi/Imin : on branchera le SDK natif dans `printer.native.ts` et on
 * exposera via une bascule dans `index.ts`. Le code appelant ne change pas.
 */

export type PrintOptions = {
  /** HTML complet du ticket (peut inclure ses propres <style>). */
  html: string;
  /** Largeur papier en mm (58 ou 80). */
  widthMm?: number;
  /** Titre éphémère (ré-affiché brièvement dans le dialogue système). */
  title?: string;
};

const MOUNT_ID = "__coligo-print-mount";
const STYLE_ID = "__coligo-print-style";

export async function printTicket({
  html,
  widthMm = 58,
  title = "Ticket Coligo",
}: PrintOptions): Promise<void> {
  if (typeof document === "undefined") return;

  // Nettoyage défensif : si un précédent print a planté, on repart propre.
  document.getElementById(MOUNT_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();

  const mount = document.createElement("div");
  mount.id = MOUNT_ID;
  mount.setAttribute("aria-hidden", "true");
  mount.innerHTML = html;
  // Hors impression : on cache visuellement le ticket sans `display:none`
  // (certains navigateurs n'impriment pas les noeuds entièrement « none »
  // au moment de basculer en print preview).
  mount.style.position = "fixed";
  mount.style.left = "-99999px";
  mount.style.top = "0";
  mount.style.width = `${widthMm}mm`;
  mount.style.pointerEvents = "none";
  mount.style.opacity = "0";

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
@media print {
  @page { size: ${widthMm}mm auto; margin: 0; }
  /* On force le ticket à occuper toute la feuille et on cache TOUT le reste.
     Reset overflow/height : si l'app a overflow:hidden sur body (drawer
     mobile ouvert, modal, etc.) le contenu serait clippé a l'impression. */
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    overflow: visible !important;
    height: auto !important;
    min-height: 0 !important;
  }
  body > *:not(#${MOUNT_ID}) {
    display: none !important;
    visibility: hidden !important;
  }
  body > #${MOUNT_ID} {
    position: static !important;
    left: auto !important;
    top: auto !important;
    width: ${widthMm}mm !important;
    margin: 0 !important;
    padding: 4mm !important;
    opacity: 1 !important;
    visibility: visible !important;
    color: #000 !important;
    background: #fff !important;
    font-size: ${widthMm === 80 ? 13 : 11}px;
    box-sizing: border-box;
  }
  body > #${MOUNT_ID} * {
    color: #000 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}
`;

  // Titre du dialogue (Chrome l'affiche dans la barre d'aperçu PDF).
  const previousTitle = document.title;
  document.title = title;

  document.head.appendChild(style);
  document.body.appendChild(mount);

  await new Promise<void>((resolve) => {
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      mount.remove();
      style.remove();
      document.title = previousTitle;
      window.removeEventListener("afterprint", cleanup);
      resolve();
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    // Garde-fou : si `afterprint` ne se déclenche pas (Chrome connu pour
    // l'oublier quand l'utilisateur ferme l'aperçu sans imprimer), on
    // nettoie au bout d'un délai raisonnable.
    window.setTimeout(cleanup, 60_000);

    // Laisse un tick au navigateur pour appliquer la feuille `@media print`
    // (sinon Chrome calcule l'aperçu sur l'ancienne mise en page).
    window.requestAnimationFrame(() => {
      try {
        window.print();
      } catch {
        cleanup();
      }
    });
  });
}
