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
}: {
  value: string;
  size?: number;
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
      // Remplace le contenu (au cas où le composant re-render avec un autre code).
      ref.current.innerHTML = "";
      ref.current.appendChild(svg);
    })();
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div
      ref={ref}
      className="border-border inline-flex items-center justify-center rounded-[14px] border bg-white p-3"
      style={{ width: size + 24, height: size + 24 }}
      aria-label={t("qrLabel", { value })}
    />
  );
}
