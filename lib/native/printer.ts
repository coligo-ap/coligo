/**
 * Impression de tickets — robuste desktop + mobile.
 *
 * Fallback pour les CAS SANS NAVIGATION possible (auto-print depuis le
 * bridge Realtime, test ticket /settings). Les impressions déclenchées par
 * un clic utilisateur passent désormais par l'endpoint isolé
 * `/print/orders/[id]` (cf. PrintOrderButton) — beaucoup plus fiable.
 *
 * Stratégie de fallback :
 *  1. On monte le ticket dans le document principal (#__coligo-print-mount).
 *  2. On pose une classe `coligo-printing` sur <body> qui — en mode ÉCRAN ET
 *     en mode PRINT — masque tout sauf le mount.
 *  3. On appelle `window.print()`, on attend `afterprint` (ou matchMedia
 *     `print` → `screen`), puis on nettoie.
 *
 * Pont natif (Sunmi V3 / APK Capacitor) :
 *  - Si `hasNativePrinterBridge()` retourne `true`, on courte-circuite
 *    `window.print()` et on délègue au SDK natif (impression directe SANS
 *    dialogue). Le hook `printViaNativeBridge()` reste un stub à brancher
 *    le jour où on intègre Capacitor + plugin imprimante (voir notes
 *    inline). Aucun changement côté code appelant.
 */

import { hasNativePrinterBridge } from "./context";

export type PrintOptions = {
  html: string;
  widthMm?: number;
  title?: string;
};

const MOUNT_ID = "__coligo-print-mount";
const STYLE_ID = "__coligo-print-style";
const BODY_CLASS = "coligo-printing";

/**
 * Point d'extension natif. Aujourd'hui : no-op (renvoie `false` → on
 * retombe sur `window.print()` après).
 *
 * BRANCHEMENTS À FAIRE LE JOUR DE L'APK :
 *
 * 1. Capacitor + plugin imprimante générique (recommandé pour Sunmi V3) :
 *    ```
 *    import { ThermalPrinter } from "@capacitor-community/thermal-printer";
 *    await ThermalPrinter.printHtml({ html, widthMm });
 *    return true;
 *    ```
 *
 * 2. SDK Sunmi WebView (sans Capacitor — Sunmi peut injecter `sunmiPrinter`
 *    dans leur navigateur intégré) :
 *    ```
 *    const bridge = (window as any).sunmiPrinter;
 *    bridge.init();
 *    bridge.setAlignment(1);
 *    bridge.printString(textVersion); // ESC/POS
 *    bridge.lineWrap(3);
 *    bridge.cutPaper();
 *    return true;
 *    ```
 *    NB : le SDK Sunmi prend du TEXTE/ESC-POS, pas du HTML — il faudra
 *    écrire un convertisseur `htmlToEscPos(html)` dans `printer.native.ts`.
 *
 * Le retour `true` signale au caller qu'on a imprimé en natif ; il NE doit
 * PAS rejouer `window.print()` derrière.
 */
async function printViaNativeBridge(opts: PrintOptions): Promise<boolean> {
  // Signature préservée pour les implémentations natives (cf. doc ci-dessus).
  // Stub no-op aujourd'hui — `void opts` signale l'intention au linter.
  void opts;
  return false;
}

export async function printTicket({
  html,
  widthMm = 58,
  title = "Ticket Coligo",
}: PrintOptions): Promise<void> {
  if (typeof document === "undefined") return;

  // Pont natif (APK / Sunmi WebView) : impression directe, pas de dialogue.
  if (hasNativePrinterBridge()) {
    const ok = await printViaNativeBridge({ html, widthMm, title });
    if (ok) return;
    // Échec du pont natif → on retombe sur window.print() ci-dessous.
  }

  // Nettoyage défensif : si un précédent print a planté en cours de route.
  document.getElementById(MOUNT_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();
  document.body.classList.remove(BODY_CLASS);

  // Sauvegarde de l'état utilisateur (restauré en fin de print).
  const previousTitle = document.title;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  document.title = title;

  const mount = document.createElement("div");
  mount.id = MOUNT_ID;
  mount.setAttribute("aria-hidden", "true");
  mount.innerHTML = html;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  // Sélecteurs scopés à `body.coligo-printing` : effet UNIQUEMENT pendant
  // la sequence d'impression, jamais en navigation normale.
  // ⚠️ On NE force PAS `color:#000` sur les descendants : le bandeau noir
  // a `color:#fff` qui doit être préservé.
  style.textContent = `
@page { size: ${widthMm}mm auto; margin: 0; }

/* ----- ÉCRAN + IMPRESSION : on masque tout sauf le mount ----- */
body.${BODY_CLASS} {
  margin: 0 !important;
  padding: 0 !important;
  background: #fff !important;
  overflow: visible !important;
  height: auto !important;
  min-height: 0 !important;
}
body.${BODY_CLASS} > * {
  display: none !important;
  visibility: hidden !important;
}
body.${BODY_CLASS} > div#${MOUNT_ID} {
  display: block !important;
  visibility: visible !important;
  position: static !important;
  width: ${widthMm}mm !important;
  max-width: 100% !important;
  margin: 0 auto !important;
  padding: 4mm !important;
  background: #fff !important;
  color: #000 !important;
  font-size: 12px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
  box-sizing: border-box;
  transform: none !important;
  filter: none !important;
  clip-path: none !important;
}
body.${BODY_CLASS} > div#${MOUNT_ID} * {
  visibility: visible !important;
  box-sizing: border-box;
}

/* ----- IMPRESSION SEULEMENT : @page + encrage exact des fonds noirs ----- */
@media print {
  html, body.${BODY_CLASS} {
    width: ${widthMm}mm !important;
  }
  body.${BODY_CLASS} > div#${MOUNT_ID} {
    margin: 0 !important;
  }
  body.${BODY_CLASS} > div#${MOUNT_ID} * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}
`;

  document.head.appendChild(style);
  document.body.appendChild(mount);
  // ORDRE IMPORTANT : on ajoute la classe APRÈS avoir mounté le ticket,
  // sinon le body est en état « tout caché » sans le ticket visible.
  document.body.classList.add(BODY_CLASS);

  await new Promise<void>((resolve) => {
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      document.body.classList.remove(BODY_CLASS);
      mount.remove();
      style.remove();
      document.title = previousTitle;
      window.scrollTo(scrollX, scrollY);
      window.removeEventListener("afterprint", cleanup);
      mediaQuery?.removeEventListener?.("change", onMediaChange);
      resolve();
    };

    window.addEventListener("afterprint", cleanup, { once: true });

    // matchMedia('print') fire quand le dialogue se ferme — plus fiable
    // qu'`afterprint` sur Chrome (mobile et desktop).
    const mediaQuery = window.matchMedia?.("print");
    const onMediaChange = (e: MediaQueryListEvent) => {
      if (!e.matches) cleanup();
    };
    mediaQuery?.addEventListener?.("change", onMediaChange);

    // Garde-fou ultime.
    window.setTimeout(cleanup, 60_000);

    // 2 frames pour laisser le navigateur appliquer la classe avant print.
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
