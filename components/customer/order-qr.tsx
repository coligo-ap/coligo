"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

/**
 * Génère un QR SVG inline pour le code de retrait, avec @zxing/browser (déjà
 * installé côté scan commerçant). Rendu côté client : la lib est browser-only.
 */
export function OrderQr({
  value,
  size = 220,
  ink,
  frameless = false,
}: {
  value: string;
  size?: number;
  /**
   * Encre des modules (défaut : noir). La carte fidélité utilise le violet de
   * marque sur panneau blanc (maquette imprimée) — le contraste reste largement
   * scannable.
   */
  ink?: string;
  /**
   * Sans bordure ni padding : le PARENT fournit le panneau blanc et la zone de
   * silence (cartes fidélité — le QR occupe tout son cadre).
   */
  frameless?: boolean;
}) {
  const t = useTranslations("orders");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { BrowserQRCodeSvgWriter } = await import("@zxing/browser");
      if (cancelled || !ref.current) return;
      const writer = new BrowserQRCodeSvgWriter();
      const svg = writer.write(value, size, size);
      if (ink) {
        // zxing dessine ses modules en <rect> : on force l'encre demandée
        // (fill posé rect par rect — prioritaire sur tout style hérité).
        svg
          .querySelectorAll("rect")
          .forEach((r) => r.setAttribute("fill", ink));
      }
      // Remplace le contenu (au cas où le composant re-render avec un autre code).
      ref.current.innerHTML = "";
      ref.current.appendChild(svg);
    })();
    return () => {
      cancelled = true;
    };
  }, [value, size, ink]);

  return (
    <div
      ref={ref}
      className={
        frameless
          ? "inline-flex items-center justify-center"
          : "border-border rounded-card-lg inline-flex items-center justify-center border p-3"
      }
      // Fond TOUJOURS blanc + modules à encre imposée (peu importe le thème
      // clair/sombre). On n'utilise PAS la classe `bg-white` car en mode sombre
      // client elle est remappée vers la surface sombre (cf. globals.css) → le
      // QR deviendrait illisible. Le style inline (priorité max) garantit un QR
      // scannable dans tous les cas ; `color` couvre le cas où le SVG zxing
      // dessine ses modules en `currentColor`.
      style={{
        width: frameless ? size : size + 24,
        height: frameless ? size : size + 24,
        backgroundColor: "#ffffff",
        color: ink ?? "#000000",
      }}
      aria-label={t("qrLabel", { value })}
    />
  );
}
