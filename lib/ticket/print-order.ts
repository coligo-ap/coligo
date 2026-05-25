"use client";

import { printTicket } from "@/lib/native";
import { hasNativePrinterBridge } from "@/lib/native/context";
import {
  buildTicketHTML,
  type TicketOrder,
} from "@/lib/ticket/build-ticket-html";
import { buildTicketSunmiCommands } from "@/lib/ticket/build-ticket-sunmi";
import type { PrintWidth } from "@/lib/types";

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
  opts: { width: PrintWidth; copies?: number; appName?: string }
): Promise<void> {
  const copies = Math.max(1, Math.min(3, opts.copies ?? 1));
  // Détection sync : si le plugin natif est chargé, on génère AUSSI les
  // commandes Sunmi pour qu'il les utilise. La détection async réelle
  // (service AIDL bindé) se fait dans `printViaNativeBridge`.
  const wantNative = hasNativePrinterBridge();

  for (let i = 1; i <= copies; i++) {
    const copyLabel = copies > 1 ? `COPIE ${i} / ${copies}` : undefined;
    const { html, widthMm } = await buildTicketHTML(order, {
      width: opts.width,
      appName: opts.appName,
      copyLabel,
    });
    const sunmiCommands = wantNative
      ? buildTicketSunmiCommands(order, {
          width: opts.width,
          appName: opts.appName,
          copyLabel,
        })
      : undefined;
    await printTicket({
      html,
      widthMm,
      title: `Ticket #${order.id.slice(0, 6).toUpperCase()}`,
      sunmiCommands,
    });
  }
}
