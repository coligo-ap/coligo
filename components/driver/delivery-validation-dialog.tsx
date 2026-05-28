"use client";

import { useState, useTransition } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { QrScanner } from "@/components/scanner/qr-scanner";
import { enqueueValidation } from "@/lib/driver-offline/db";
import { validateDelivery } from "@/app/(driver)/actions";

/**
 * Dialog de validation de livraison — saisie code OU scan QR.
 * Règles (cf. prompt 9 / migration 0041) :
 *  - online : code OBLIGATOIRE (le bouton « sans code » est désactivé).
 *  - cash   : code encouragé mais bouton « valider sans code » disponible
 *    (tracé `validated_without_code`).
 */
export function DeliveryValidationDialog({
  orderId,
  paymentMethod,
  onClose,
  onSuccess,
}: {
  orderId: string;
  paymentMethod: "cash" | "online";
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [pending, start] = useTransition();

  const isOnline = paymentMethod === "online";

  const submit = (skip: boolean) =>
    start(async () => {
      // Hors ligne ? On enqueue, le processeur sync au retour réseau.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueueValidation({
          orderId,
          code: code || null,
          skipCode: skip,
        });
        toast.success("Validation enregistrée — sera synchronisée");
        onSuccess();
        return;
      }
      const r = await validateDelivery({
        orderId,
        code: code || undefined,
        skipCode: skip,
      });
      if (!r.ok) {
        // Si erreur transitoire (réseau coupé en plein vol), on enqueue
        // pour rejouer. On distingue les vraies erreurs métier.
        if (
          r.reason &&
          [
            "bad_code",
            "online_requires_code",
            "not_attributed_to_you",
            "order_not_found",
            "already_delivered",
          ].includes(r.reason)
        ) {
          toast.error(reasonLabel(r.reason));
          return;
        }
        await enqueueValidation({
          orderId,
          code: code || null,
          skipCode: skip,
        });
        toast.success("Validation en attente — synchro auto");
        onSuccess();
        return;
      }
      toast.success("Livraison validée ✓");
      onSuccess();
    });

  const handleScannedText = (text: string) => {
    // Le QR encode soit directement les 6 chiffres, soit une URL contenant
    // le code (`/orders/validate?code=123456` selon le générateur existant).
    const digits = text.match(/\d{6}/)?.[0];
    if (digits) {
      setCode(digits);
      setScanning(false);
      toast.success("Code détecté");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div className="bg-surface w-full max-w-md space-y-4 rounded-[14px] p-5 shadow-xl">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Valider la livraison</h2>
            <p className="text-muted mt-0.5 text-xs">
              {isOnline
                ? "Commande payée en ligne : demande au client son code de retrait à 6 chiffres. Le code est OBLIGATOIRE."
                : "Commande en espèces : encaisse le montant puis confirme la remise. Aucun code n'est demandé au client."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:bg-surface-2 -mt-1 -mr-1 rounded p-1"
          >
            <X className="size-4" />
          </button>
        </header>

        {isOnline ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="code">Code de retrait (6 chiffres)</Label>
              <div className="flex gap-2">
                <Input
                  id="code"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="font-mono text-base tracking-widest"
                  disabled={pending}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setScanning((v) => !v)}
                  disabled={pending}
                >
                  <Camera className="size-4" />
                  {scanning ? "Fermer" : "Scanner"}
                </Button>
              </div>
            </div>

            {scanning && (
              <div className="overflow-hidden rounded-[12px]">
                <QrScanner onScan={handleScannedText} />
              </div>
            )}

            <Button
              type="button"
              onClick={() => submit(false)}
              disabled={pending || code.length !== 6}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Valider la livraison
            </Button>
            <p className="text-subtle text-xs">
              💡 Si le client n&apos;est pas là, un proche qui réceptionne peut
              lui demander le code à communiquer.
            </p>
          </>
        ) : (
          <>
            <p className="border-warning-200 bg-warning-50 text-warning-800 rounded-[10px] border px-3 py-2 text-xs">
              Encaisse le montant en espèces auprès du client, puis confirme la
              remise. Pas de code à saisir pour une commande cash.
            </p>
            <Button
              type="button"
              onClick={() => {
                if (
                  confirm("Confirmer la remise au client (paiement cash) ?")
                ) {
                  submit(true);
                }
              }}
              disabled={pending}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Confirmer la livraison
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function reasonLabel(reason?: string): string {
  switch (reason) {
    case "online_requires_code":
      return "Code requis pour les commandes payées en ligne.";
    case "bad_code":
      return "Code incorrect.";
    case "not_attributed_to_you":
      return "Cette commande ne t'est pas attribuée.";
    case "not_a_delivery":
      return "Ce n'est pas une commande livraison.";
    case "order_not_found":
      return "Commande introuvable.";
    case "already_delivered":
      return "Déjà validée.";
    default:
      return reason ?? "Erreur";
  }
}
