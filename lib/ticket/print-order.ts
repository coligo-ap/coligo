"use client";

import { printTicket } from "@/lib/native";
import {
  buildTicketHTML,
  type TicketOrder,
} from "@/lib/ticket/build-ticket-html";
import type { PrintWidth } from "@/lib/types";

/**
 * Imprime un ticket de commande. Si `copies > 1`, lance l'impression N fois
 * (chaque exemplaire mentionne « COPIE k/N » en tête).
 *
 * On séquence les copies (await en boucle) pour que le dialogue système se
 * referme entre deux exemplaires — sinon Chrome empile les onglets de print.
 */
export async function printOrderTicket(
  order: TicketOrder,
  opts: { width: PrintWidth; copies?: number; appName?: string }
): Promise<void> {
  const copies = Math.max(1, Math.min(3, opts.copies ?? 1));
  for (let i = 1; i <= copies; i++) {
    const copyLabel = copies > 1 ? `COPIE ${i} / ${copies}` : undefined;
    const { html, widthMm } = await buildTicketHTML(order, {
      width: opts.width,
      appName: opts.appName,
      copyLabel,
    });
    await printTicket({
      html,
      widthMm,
      title: `Ticket #${order.id.slice(0, 6).toUpperCase()}`,
    });
  }
}
