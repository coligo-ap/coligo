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
import {
  isSunmiPrinterAvailable,
  printSunmi,
  printSunmiBitmap,
  type SunmiCommand,
} from "./sunmi-printer";

export type PrintOptions = {
  html: string;
  widthMm?: number;
  title?: string;
  /**
   * Commandes Sunmi équivalentes — si fournies et qu'un pont natif Sunmi est
   * dispo (`hasNativePrinterBridge()` + service bindé), on imprime
   * directement via le SDK sans dialogue. Côté PWA / autres APK : ignoré et
   * fallback `window.print()` sur le HTML.
   */
  sunmiCommands?: SunmiCommand[];
  /**
   * PNG base64 (SANS préfixe data:) du ticket rendu en bitmap canvas — chemin
   * natif PRIORITAIRE sur l'imprimante intégrée Sunmi. Le firmware ne sait pas
   * varier la taille/police via l'API texte ; le bitmap donne le rendu fidèle,
   * compact et net. Cf. `lib/ticket/render-ticket-canvas.ts`.
   */
  bitmapBase64?: string;
  /** Nb de copies pour le mode Sunmi (le HTML gère ses copies côté caller). */
  copies?: number;
};

const MOUNT_ID = "__coligo-print-mount";
const STYLE_ID = "__coligo-print-style";
const BODY_CLASS = "coligo-printing";

/**
 * Pont natif d'impression. Branché sur le plugin Capacitor `SunmiPrinter`
 * (`android/.../sunmi/SunmiPrinterPlugin.java`).
 *
 * Stratégie en 2 étapes, dans cet ordre :
 *
 *  1. **Commandes texte + QR natif (préféré)** : `printSunmi(commands)` —
 *     texte via `printColumnsText` et QR via `printQRCode` (rendu CRISP,
 *     identique au « print test » Sunmi). Pas de gros aplats noirs, pas
 *     d'antialiasing : c'est la voie la plus propre et la plus fiable sur
 *     thermique 80mm. Le ticket sort TOUJOURS en entier (mode direct côté
 *     plugin Java).
 *
 *  2. **Bitmap (fallback)** : `html2canvas` capture l'HTML → PNG monochrome
 *     576px → `printBitmap`. Plus fidèle visuellement à la maquette mais plus
 *     lourd (gros aplats noirs qui « bavent » sur thermique, risque de
 *     troncature). On ne l'utilise que si les commandes texte sont absentes.
 *
 * Retourne `true` UNIQUEMENT si l'une des 2 voies a réussi ; sinon le
 * caller retombe sur `window.print()`.
 */
async function printViaNativeBridge(opts: PrintOptions): Promise<boolean> {
  const ok = await isSunmiPrinterAvailable();
  if (!ok) return false;

  // 1. BITMAP canvas (PRIORITAIRE) — rendu fidèle, tailles/polices libres,
  //    interligne maîtrisé, compact. C'est la seule voie correcte sur le
  //    firmware intégré (l'API texte ne sait pas varier taille/police et les
  //    sendRAWData superflus font des tickets à rallonge).
  if (opts.bitmapBase64) {
    const bmpOk = await printSunmiBitmap({
      bitmap: opts.bitmapBase64,
      copies: 1,
      buffer: true,
      cut: true,
      feedLines: 2,
    });
    if (bmpOk) return true;
  }

  // 2. Commandes texte + QR natif (fallback si pas de bitmap fourni).
  if (opts.sunmiCommands && opts.sunmiCommands.length > 0) {
    const cmdOk = await printSunmi({
      commands: opts.sunmiCommands,
      copies: 1,
    });
    if (cmdOk) return true;
  }

  // 3. Fallback bitmap (capture HTML html2canvas) en dernier recours.
  if (opts.html) {
    try {
      const { printTicketBitmap } =
        await import("@/lib/ticket/print-ticket-bitmap");
      const bitmapOk = await printTicketBitmap({
        html: opts.html,
        copies: opts.copies ?? 1,
      });
      if (bitmapOk) return true;
    } catch (err) {
      console.warn("[printer] bitmap path failed, falling back", err);
    }
  }

  return false;
}

export async function printTicket({
  html,
  widthMm = 58,
  title = "Ticket Coligo",
  sunmiCommands,
  bitmapBase64,
  copies,
}: PrintOptions): Promise<void> {
  if (typeof document === "undefined") return;

  // Pont natif (APK / Sunmi WebView) : impression directe, pas de dialogue.
  if (hasNativePrinterBridge()) {
    // BUG FIX : transmettre sunmiCommands au pont — sans ça,
    // printViaNativeBridge recevait undefined et retournait false → silently
    // fallback sur window.print() (no-op dans le WebView Capacitor).
    const ok = await printViaNativeBridge({
      html,
      widthMm,
      title,
      sunmiCommands,
      bitmapBase64,
      copies,
    });
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
  /* 2mm/côté → zone imprimable 76mm sur rouleau 80mm. */
  padding: 2mm !important;
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

  // Attendre les images du ticket (logo de marque) avant d'imprimer — sinon le
  // premier window.print() part avant leur décodage. Plafond 1,5 s : au-delà,
  // on imprime quand même (le texte alt remplace l'image manquante).
  const ticketImgs = Array.from(mount.querySelectorAll("img"));
  await Promise.race([
    Promise.all(
      ticketImgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((res) => {
              img.addEventListener("load", () => res(), { once: true });
              img.addEventListener("error", () => res(), { once: true });
            })
      )
    ),
    new Promise<void>((res) => window.setTimeout(res, 1500)),
  ]);

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
