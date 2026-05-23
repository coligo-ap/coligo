"use client";

import { useEffect, useState } from "react";
import {
  buildTicketHTML,
  type TicketOrder,
  type BuildTicketOptions,
} from "@/lib/ticket/build-ticket-html";
import type { PrintWidth } from "@/lib/types";

type Props = {
  order: TicketOrder;
  width: PrintWidth;
  appName?: string;
  copyLabel?: string;
  /** Hauteur d'aperçu en pixels (le ticket est sinon fluide). */
  className?: string;
};

/**
 * Prévisualisation du ticket — strictement le même rendu que celui imprimé
 * (mêmes styles, même builder). On utilise une iframe `srcDoc` pour reproduire
 * fidèlement le contexte d'impression : largeur en mm, monochrome, marges 0.
 *
 * Avantage iframe : les styles du ticket ne fuient pas dans l'app, et la
 * largeur réelle s'exprime en mm comme à l'impression.
 */
export function OrderTicket({
  order,
  width,
  appName,
  copyLabel,
  className,
}: Props) {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const opts: BuildTicketOptions = { width, appName, copyLabel };
    buildTicketHTML(order, opts).then(({ html }) => {
      if (cancelled) return;
      // L'iframe rend les mêmes styles que printTicket() côté serveur navigateur.
      const doc = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    width: ${width}mm;
    padding: 4mm;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 12px;
    color: #000;
  }
  * { box-sizing: border-box; }
</style>
</head><body>${html}</body></html>`;
      setSrcDoc(doc);
    });
    return () => {
      cancelled = true;
    };
  }, [order, width, appName, copyLabel]);

  return (
    <iframe
      title={`Ticket ${order.id}`}
      srcDoc={srcDoc ?? ""}
      // 1mm ≈ 3.78px. On affiche à 4 px/mm pour un peu de marge.
      style={{
        width: `${width * 4 + 24}px`,
        height: 720,
        border: "1px solid #ececf2",
        borderRadius: 8,
        background: "#fff",
        display: "block",
      }}
      className={className}
    />
  );
}
