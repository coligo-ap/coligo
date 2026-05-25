"use client";

/**
 * Impression du ticket par CAPTURE HTML → PNG → bitmap Sunmi.
 *
 * Pourquoi cette approche ?
 * ------------------------
 * Le builder texte (`buildTicketSunmiCommands`) doit batailler avec le
 * firmware Sunmi V3 (printText ignoré, setAlignment partiel, set de tailles
 * autorisées étroit). Le résultat marche mais le rendu n'est jamais 100%
 * fidèle à la maquette `maquette-ticket-80mm.html`.
 *
 * Avec html2canvas on capture l'HTML EXACT (avec Sora, bandeau inversé,
 * encadré paiement, leader dots, etc.) et on envoie un PNG monochrome à
 * l'imprimante. Le rendu thermique est alors PIXEL-IDENTIQUE à l'écran.
 *
 * Pipeline :
 *   1. Mount du HTML hors-écran à la LARGEUR D'IMPRESSION (300px ≈ 80mm
 *      à 96dpi) — c'est CE rendu qui sera capturé, pas l'aperçu courant.
 *   2. Attente `document.fonts.ready` pour que Sora soit chargée (sinon
 *      fallback Courier New qui ne matche pas la maquette).
 *   3. `html2canvas` avec `scale: 2` pour le supersampling (qualité), puis
 *      redimensionnement à 576px max (= 80mm × 8 dots/mm sur V3).
 *   4. **Binarisation** seuil 128 : tout pixel < 128 → noir, sinon blanc.
 *      Élimine l'antialiasing qui sort dégueulasse en thermique.
 *   5. `toDataURL('image/png')` → strip du préfixe `data:image/png;base64,`.
 *   6. `printSunmiBitmap({ bitmap, copies, buffer:true, cut:true })`.
 *
 * Performance : ticket typique ≈ 576 × 1400 px binarisé → ~30-80 Ko en
 * PNG (largement < 1 Mo). Capture totale ≈ 300-500 ms sur Sunmi V3.
 */

import {
  isSunmiPrinterAvailable,
  printSunmiBitmap,
} from "@/lib/native/sunmi-printer";

export type PrintBitmapOptions = {
  /**
   * Fragment HTML du ticket (sortie de `buildTicketHTML`). Doit déjà
   * inclure son propre `<style>` interne.
   */
  html: string;
  /** Largeur logique d'aperçu (px). Maquette = 300. Défaut : 300. */
  renderWidth?: number;
  /** Largeur physique cible imprimante (dots). V3 80mm = 576. Défaut : 576. */
  targetWidth?: number;
  /** Seuil de binarisation 0–255. 128 = milieu. Plus haut = plus de noir. */
  threshold?: number;
  /** Nb d'exemplaires (1–5). Défaut : 1. */
  copies?: number;
  /** Coupe le papier après chaque copie. Défaut : true. */
  cut?: boolean;
};

/**
 * Capture l'HTML en PNG monochrome 576px et l'imprime sur Sunmi.
 * Retourne `true` si l'impression a réussi, `false` si Sunmi indispo ou
 * échec de capture (le caller peut alors fallback vers `window.print()`).
 */
export async function printTicketBitmap(
  opts: PrintBitmapOptions
): Promise<boolean> {
  if (typeof document === "undefined") return false;

  // Pré-check : si le pont Sunmi n'est pas dispo, inutile de capturer.
  const sunmiOk = await isSunmiPrinterAvailable();
  if (!sunmiOk) {
    console.info("[print-bitmap] Sunmi unavailable, skip bitmap path");
    return false;
  }

  const renderWidth = opts.renderWidth ?? 300;
  const targetWidth = opts.targetWidth ?? 576;
  const threshold = opts.threshold ?? 128;
  const copies = Math.max(1, Math.min(5, opts.copies ?? 1));
  const cut = opts.cut ?? true;

  // 1. Mount offscreen (left: -10000px pour ne pas être visible ni scrollable
  //    mais TOUJOURS layouté — html2canvas ne capture pas un display:none).
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = [
    "position: absolute",
    "left: -10000px",
    "top: 0",
    `width: ${renderWidth}px`,
    "background: #fff",
    "color: #000",
    "z-index: -1",
    "pointer-events: none",
  ].join(";");
  host.innerHTML = opts.html;
  document.body.appendChild(host);

  try {
    // 2. Attendre que toutes les fonts (Sora) soient chargées avant capture
    if (document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch {
        /* ignored */
      }
    }
    // Laisse 2 rAF pour que le layout se pose après l'injection.
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r()))
    );

    // 3. Capture html2canvas — scale:1 pour limiter la taille mémoire et
    //    rester sous 1 Mo après export. Le supersampling n'apporte rien ici
    //    puisqu'on binarise ensuite : tout pixel devient 0 ou 255, donc
    //    l'antialiasing du scale:2 serait écrasé de toute façon.
    const html2canvas = (await import("html2canvas")).default;
    const captured = await html2canvas(host, {
      backgroundColor: "#ffffff",
      scale: 1,
      logging: false,
      useCORS: true,
      // Largeur fixe = renderWidth (300px). html2canvas calcule la hauteur.
      width: renderWidth,
      windowWidth: renderWidth,
    });

    // 4. Redimensionnement → targetWidth, ratio conservé, SANS antialiasing
    const ratio = targetWidth / captured.width;
    const targetHeight = Math.round(captured.height * ratio);
    const resized = document.createElement("canvas");
    resized.width = targetWidth;
    resized.height = targetHeight;
    const ctx = resized.getContext("2d");
    if (!ctx) {
      console.warn("[print-bitmap] 2D context unavailable");
      return false;
    }
    ctx.imageSmoothingEnabled = false;
    // Fond blanc explicite (le canvas resized n'hérite pas du fond du source)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(captured, 0, 0, targetWidth, targetHeight);

    // 5. Binarisation in-place : chaque pixel >= threshold → blanc, sinon
    //    noir. Niveau de gris ITU-R BT.601 (0.299/0.587/0.114) — standard
    //    pour la binarisation thermique, donne le meilleur rendu sur texte
    //    qui contient parfois des accents anti-aliasés. Sur un ticket
    //    N&B strict comme la maquette, peu importe le coefficient choisi :
    //    le bandeau noir reste noir, le texte reste noir, le fond reste
    //    blanc. Le seuil 128 (milieu) est fixe — un tramage Bayer ajouterait
    //    du bruit sur le texte sans bénéfice (pas de dégradé à préserver).
    const img = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const bw = gray >= threshold ? 255 : 0;
      d[i] = bw;
      d[i + 1] = bw;
      d[i + 2] = bw;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    // 6. Export base64 PNG, strip du préfixe data:image/png;base64,
    const dataUrl = resized.toDataURL("image/png");
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    const sizeKo = Math.round((base64.length * 3) / 4 / 1024);
    console.info(
      `[print-bitmap] captured ${targetWidth}×${targetHeight}px ${sizeKo}Ko, sending to Sunmi`
    );

    // 7. Envoi au plugin Sunmi (enter/exitBuffer côté Java)
    const ok = await printSunmiBitmap({
      bitmap: base64,
      copies,
      buffer: true,
      cut,
      feedLines: 3,
    });
    if (!ok) {
      console.warn("[print-bitmap] Sunmi printBitmap returned false");
    }
    return ok;
  } catch (err) {
    console.warn("[print-bitmap] capture failed", err);
    return false;
  } finally {
    host.remove();
  }
}
