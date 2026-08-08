"use client";

import { useState } from "react";
import { ScanBarcode, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Portal } from "@/components/ui/portal";
import { QrScanner } from "@/components/scanner/qr-scanner";

// =============================================================================
// BarcodeField — champ « Code-barres (EAN) » du formulaire produit commerçant :
// saisie manuelle (une douchette Sunmi tape directement dedans, clavier-wedge)
// OU scan caméra (bouton → plein écran, QrScanner mode barcode, un seul scan).
// Alimente le match EXACT du scan client (phase 2, mig 0362).
// =============================================================================

export function BarcodeField({
  defaultValue,
  disabled,
}: {
  defaultValue?: string | null;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        <Input
          name="barcode"
          value={value}
          onChange={(e) =>
            setValue(e.target.value.replace(/\D/g, "").slice(0, 14))
          }
          inputMode="numeric"
          placeholder="Scannez ou saisissez l'EAN"
          disabled={disabled}
          className="tabular-nums"
        />
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          title="Scanner avec la caméra"
          aria-label="Scanner le code-barres avec la caméra"
          className="border-border-strong text-foreground hover:bg-surface-2 grid size-12 shrink-0 place-items-center rounded-md border disabled:opacity-50"
        >
          <ScanBarcode className="size-5" />
        </button>
      </div>
      <p className="text-subtle text-xs">
        Permet aux clients de retrouver ce produit en scannant son code-barres.
      </p>

      {open && (
        <Portal>
          <div className="fixed inset-0 z-[120] flex flex-col bg-black">
            <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-2">
              <p className="text-title-sm font-extrabold text-white">
                Scanner le code-barres
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                className="grid size-9 place-items-center rounded-full bg-white/15 text-white"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
              <QrScanner
                mode="barcode"
                oneShot
                onScan={(text) => {
                  const digits = text.replace(/\D/g, "").slice(0, 14);
                  if (digits.length >= 8) {
                    setValue(digits);
                    setOpen(false);
                  }
                }}
                className="rounded-panel aspect-[7/5] w-full max-w-[360px] overflow-hidden"
              />
              <p className="text-body-sm mt-4 max-w-[300px] text-center font-semibold text-white/85">
                Visez le code-barres du produit.
              </p>
            </div>
            <div className="h-[calc(env(safe-area-inset-bottom)+1rem)]" />
          </div>
        </Portal>
      )}
    </>
  );
}
