"use client";

import { printTicket } from "@/lib/native";
import { hasNativePrinterBridge } from "@/lib/native/context";
import {
  buildTicketHTML,
  type TicketOrder,
} from "@/lib/ticket/build-ticket-html";
import { buildTicketSunmiCommands } from "@/lib/ticket/build-ticket-sunmi";
import { renderTicketCanvasBase64 } from "@/lib/ticket/render-ticket-canvas";
import type { PrintLang, PrintWidth } from "@/lib/types";

/**
 * Imprime un ticket de commande. Si `copies > 1`, lance l'impression N fois
 * (chaque exemplaire mentionne « COPIE k/N » en tête).
 *
 * Stratégie d'impression :
 *  - APK Capacitor sur Sunmi (V1/V2/T2/V3) : commandes AIDL directes via le
 *    plugin `SunmiPrinter`, SANS dialogue. Fallback `window.print()` si le
 *    service AIDL n'est pas bindé (autre appareil Android).
 *  - PWA / desktop : `window.print()` sur le HTML (Coligo a un layout
 *    typographique épuré qui s'imprime bien thermique aussi).
 *
 * Les copies sont séquencées côté caller (await en boucle) : sur thermique
 * Sunmi, ça donne N tickets imprimés à la suite ; sur navigateur, ça laisse
 * le dialogue se refermer entre deux exemplaires (sinon Chrome empile).
 */
export async function printOrderTicket(
  order: TicketOrder,
  opts: {
    width: PrintWidth;
    copies?: number;
    appName?: string;
    /** Langue UNIQUE du ticket (jamais FR/AR mélangés) — défaut 'fr'. */
    lang?: PrintLang;
  }
): Promise<void> {
  const copies = Math.max(1, Math.min(3, opts.copies ?? 1));
  // Détection sync : si le plugin natif est chargé, on génère AUSSI les
  // commandes Sunmi pour qu'il les utilise. La détection async réelle
  // (service AIDL bindé) se fait dans `printViaNativeBridge`.
  const wantNative = hasNativePrinterBridge();
  try {
    console.info(
      `[print-order] order=${order.id} copies=${copies} wantNative=${wantNative}`
    );
  } catch {
    /* ignored */
  }

  for (let i = 1; i <= copies; i++) {
    const copyLabel = copies > 1 ? `COPIE ${i} / ${copies}` : undefined;
    const { html, widthMm } = await buildTicketHTML(order, {
      width: opts.width,
      appName: opts.appName,
      copyLabel,
      lang: opts.lang,
    });
    // NB : les commandes TEXTE Sunmi restent FR (l'API AIDL texte ne shape pas
    // l'arabe) — ce n'est qu'un repli si le bitmap échoue, et il reste
    // monolingue. Le rendu normal (bitmap canvas) porte la langue choisie.
    const sunmiCommands = wantNative
      ? buildTicketSunmiCommands(order, {
          width: opts.width,
          appName: opts.appName,
          copyLabel,
        })
      : undefined;
    // Chemin natif PRIORITAIRE : ticket rendu en bitmap canvas (seul rendu
    // fidèle/compact sur l'imprimante intégrée Sunmi — l'API texte ne sait pas
    // varier taille/police et fait des tickets à rallonge). Échec → on garde
    // les commandes texte / window.print() en fallback.
    let bitmapBase64: string | undefined;
    if (wantNative) {
      try {
        const rendered = await renderTicketCanvasBase64(order, {
          width: opts.width,
          appName: opts.appName,
          copyLabel,
          lang: opts.lang,
        });
        bitmapBase64 = rendered?.base64;
      } catch (err) {
        console.warn("[print-order] rendu bitmap échoué, fallback", err);
      }
    }
    try {
      console.info(
        `[print-order] copy=${i}/${copies} bitmap=${
          bitmapBase64 ? "oui" : "non"
        } sunmiCmds=${sunmiCommands?.length ?? 0}`
      );
    } catch {
      /* ignored */
    }
    await printTicket({
      html,
      widthMm,
      title: `Ticket #${order.id.slice(0, 6).toUpperCase()}`,
      sunmiCommands,
      bitmapBase64,
    });
  }
}
