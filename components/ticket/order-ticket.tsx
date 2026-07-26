"use client";

import { useEffect, useState } from "react";
import {
  buildTicketHTML,
  type TicketOrder,
  type BuildTicketOptions,
} from "@/lib/ticket/build-ticket-html";
import type { PrintLang, PrintWidth } from "@/lib/types";

type Props = {
  order: TicketOrder;
  width: PrintWidth;
  appName?: string;
  copyLabel?: string;
  /** Langue UNIQUE du ticket (jamais FR/AR mélangés) — défaut 'fr'. */
  lang?: PrintLang;
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
  lang,
  className,
}: Props) {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const opts: BuildTicketOptions = { width, appName, copyLabel, lang };
    buildTicketHTML(order, opts).then(({ html }) => {
      if (cancelled) return;
      // L'iframe reproduit le contexte d'impression : même font sans-serif
      // (style Deliveroo) que la route /print et la maquette de référence.
      const doc = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    width: ${width}mm;
    /* 2mm/côté → zone imprimable réelle. */
    padding: 2mm;
    font-family: Arial, Helvetica, "Segoe UI", sans-serif;
    font-size: 13px;
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
  }, [order, width, appName, copyLabel, lang]);

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
