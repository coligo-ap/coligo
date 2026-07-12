"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, ScanBarcode, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Portal } from "@/components/ui/portal";
import { QrScanner } from "@/components/scanner/qr-scanner";
import { scanBarcode } from "@/app/(customer)/barcode-actions";
import type { BarcodeSurface } from "@/lib/barcode/resolve";

// =============================================================================
// BarcodeScanButton — icône « scanner un code-barres » posée DANS une barre de
// recherche (accueil marketplace / fiche commerçant). Ouvre un plein écran
// caméra (QrScanner mode "barcode" : EAN-13/8, UPC), résout le code côté
// serveur (catalogue local → OpenFoodFacts) puis remonte le NOM du produit à
// l'appelant, qui l'injecte dans sa recherche. Non résolu → message inline,
// on continue de scanner. Le rendu du bouton est GATÉ côté serveur (feature
// flag par surface) : ce composant n'est monté que si la surface est active.
// =============================================================================

export function BarcodeScanButton({
  surface,
  onFound,
  className,
}: {
  surface: BarcodeSurface;
  /** Reçoit le NOM résolu — l'appelant l'injecte dans sa recherche. */
  onFound: (name: string) => void;
  className?: string;
}) {
  const t = useTranslations("barcode");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleScan(raw: string) {
    if (busy) return;
    const ean = raw.replace(/\D/g, "");
    if (ean.length < 8) return;
    setBusy(true);
    setError(null);
    const res = await scanBarcode({ ean, surface });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      onFound(res.name);
      return;
    }
    // Non résolu → message inline avec le code lu, on laisse scanner.
    setError(
      res.error === "not_found" ? t("notFound", { ean }) : t("scanError")
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        aria-label={t("button")}
        className={cn(
          "text-foreground hover:text-primary-700 shrink-0 transition-colors",
          className
        )}
      >
        <ScanBarcode className="size-5" />
      </button>

      {open && (
        <Portal>
          <div className="fixed inset-0 z-[120] flex flex-col bg-black">
            <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-2">
              <p className="text-[15px] font-extrabold text-white">
                {t("title")}
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("close")}
                className="grid size-9 place-items-center rounded-full bg-white/15 text-white"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
              <QrScanner
                mode="barcode"
                oneShot={false}
                onScan={(text) => void handleScan(text)}
                className="aspect-square w-full max-w-[300px] overflow-hidden rounded-[24px]"
              />
              <p className="mt-4 max-w-[300px] text-center text-[13px] font-semibold text-white/85">
                {t("hint")}
              </p>
              {busy && (
                <p className="mt-3 inline-flex items-center gap-2 text-[13px] font-bold text-white">
                  <Loader2 className="size-4 animate-spin" />
                  {t("searching")}
                </p>
              )}
              {error && !busy && (
                <p className="bg-danger-50 text-danger-700 mt-3 max-w-[300px] rounded-[12px] px-3.5 py-2 text-center text-[12.5px] font-semibold">
                  {error}
                </p>
              )}
            </div>
            <div className="h-[calc(env(safe-area-inset-bottom)+1rem)]" />
          </div>
        </Portal>
      )}
    </>
  );
}
