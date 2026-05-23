/**
 * Impression de tickets.
 *
 * Approche : on monte le ticket DANS le document principal puis on appelle
 * `window.print()`. Une feuille `@media print` injectée en même temps
 *   1) masque agressivement TOUT le reste de la page (`body > *` → none, sauf
 *      le mount qu'on ré-active par un sélecteur plus spécifique) ;
 *   2) place le mount au seul emplacement visible avec `position: absolute;
 *      inset: 0` pour garantir qu'il occupe la feuille ;
 *   3) impose `@page { size: <width>mm auto; margin: 0 }` pour la thermique.
 *
 * Pourquoi pas un iframe : Chrome remonte parfois `print()` au document
 * parent → l'app entière s'imprime derrière le ticket. La technique
 * « masquer tout sauf le mount » est la seule fiable cross-browser.
 *
 * APK Sunmi/Imin : on branchera le SDK natif dans `printer.native.ts` et on
 * exposera via une bascule dans `index.ts`. Le code appelant ne change pas.
 */

export type PrintOptions = {
  html: string;
  widthMm?: number;
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
  // Hors impression : caché visuellement, hors flux. On garde `display:block`
  // pour que les styles internes du ticket s'appliquent quand même (sinon
  // certains navigateurs ne calculent pas le layout du subtree au moment du
  // basculement vers @media print).
  mount.style.cssText = [
    "position: fixed",
    "left: -99999px",
    "top: 0",
    `width: ${widthMm}mm`,
    "pointer-events: none",
    "opacity: 0",
    "z-index: -1",
  ].join(";");

  const style = document.createElement("style");
  style.id = STYLE_ID;
  // Sélecteurs simples et explicites. `body > #mount` est délibérément plus
  // spécifique que `body > *` pour passer outre le hide global.
  style.textContent = `
@page { size: ${widthMm}mm auto; margin: 0; }
@media print {
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    overflow: visible !important;
    height: auto !important;
    min-height: 0 !important;
  }
  /* On masque TOUT au niveau body sans exception... */
  body > * {
    display: none !important;
    visibility: hidden !important;
  }
  /* ...puis on ré-affiche uniquement le mount, en surchargeant le hide via
     un sélecteur plus spécifique (#id battra *). */
  body > div#${MOUNT_ID} {
    display: block !important;
    visibility: visible !important;
    position: absolute !important;
    inset: 0 !important;
    left: 0 !important;
    top: 0 !important;
    right: auto !important;
    bottom: auto !important;
    width: ${widthMm}mm !important;
    margin: 0 !important;
    padding: 4mm !important;
    opacity: 1 !important;
    z-index: 2147483647 !important;
    color: #000 !important;
    background: #fff !important;
    font-size: ${widthMm === 80 ? 13 : 11}px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
    box-sizing: border-box;
    transform: none !important;
    filter: none !important;
    clip-path: none !important;
  }
  body > div#${MOUNT_ID} * {
    visibility: visible !important;
    color: #000 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}
`;

  // Titre dans l'aperçu PDF (Chrome l'affiche dans la barre supérieure).
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
      mediaQuery?.removeEventListener?.("change", onMediaChange);
      resolve();
    };

    // `afterprint` est l'API officielle (déclenchée après impression OU
    // annulation), mais peu fiable sur Chrome dans certains cas.
    window.addEventListener("afterprint", cleanup, { once: true });

    // Garde-fou via matchMedia : Chrome bascule `print` → `screen` quand le
    // dialogue se ferme. C'est plus fiable que `afterprint`.
    const mediaQuery = window.matchMedia?.("print");
    const onMediaChange = (e: MediaQueryListEvent) => {
      if (!e.matches) cleanup();
    };
    mediaQuery?.addEventListener?.("change", onMediaChange);

    // Garde-fou ultime : timeout long.
    window.setTimeout(cleanup, 60_000);

    // Laisse 2 frames au navigateur pour appliquer la feuille @media print.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        try {
          window.print();
        } catch {
          cleanup();
        }
      });
    });
  });
}
