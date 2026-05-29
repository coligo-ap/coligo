"use client";

import { useRef, useState, useTransition } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { QrScanner } from "@/components/scanner/qr-scanner";
import { enqueueValidation } from "@/lib/driver-offline/db";
import { validateDelivery } from "@/app/(driver)/actions";

/**
 * Écran 4 — VALIDATION DE LIVRAISON (plein écran, e-ticket style Uber).
 *
 * Le livreur SCANNE le QR du client (caméra live au centre du ticket) OU saisit
 * son code de retrait à 6 chiffres. Style purement refait ; la logique métier
 * anti-fraude est inchangée (cf. prompt 9 / migration 0041) :
 *  - online : code OBLIGATOIRE (CTA désactivé tant que 6 chiffres absents).
 *  - cash   : code encouragé mais validation possible sans code (tracée
 *    `validated_without_code=true`).
 * Le mode hors-ligne (enqueue + synchro auto) est conservé tel quel.
 */
export function DeliveryValidationDialog({
  orderId,
  paymentMethod,
  customerName,
  totalDa,
  onClose,
  onSuccess,
}: {
  orderId: string;
  paymentMethod: "cash" | "online";
  customerName?: string | null;
  totalDa?: number | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const isOnline = paymentMethod === "online";
  const orderRef = orderId.replace(/-/g, "").slice(0, 6).toUpperCase();
  const paymentLabel = isOnline
    ? "En ligne · payé"
    : `Cash${totalDa != null ? ` · ${totalDa} DA` : ""}`;

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
        // Vraies erreurs métier : on affiche. Erreur transitoire (réseau coupé
        // en plein vol) : on enqueue pour rejouer.
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
      toast.success("Code détecté");
    }
  };

  // CTA : online → submit avec code. cash → submit avec code si saisi, sinon
  // validation sans code (confirmée + tracée).
  const onValidateClick = () => {
    if (isOnline) {
      submit(false);
      return;
    }
    if (code.length === 6) {
      submit(false);
      return;
    }
    if (confirm("Confirmer la remise au client (paiement cash) ?")) {
      submit(true);
    }
  };

  const ctaDisabled = pending || (isOnline && code.length !== 6);
  const boxes = Array.from({ length: 6 }, (_, i) => code[i] ?? "");
  const curIdx = Math.min(code.length, 5);

  return (
    <div className="fixed inset-0 z-[95] overflow-auto bg-[#f2f2f2] pt-[max(48px,calc(env(safe-area-inset-top)+18px))] pb-[max(24px,env(safe-area-inset-bottom))] text-[#0a0a0a]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pb-5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Retour"
          className="grid size-[38px] place-items-center rounded-full bg-white text-[#0a0a0a] shadow-[0_2px_6px_rgba(0,0,0,.06)] active:scale-95"
        >
          <ArrowLeft className="size-[18px]" />
        </button>
        <h2 className="text-[19px] font-extrabold">Valider la livraison</h2>
      </div>

      {/* Ticket */}
      <div className="mx-4 overflow-hidden rounded-[16px] bg-white shadow-[0_4px_16px_rgba(0,0,0,.06)]">
        <div className="relative border-b-2 border-dashed border-[#e5e5e5] px-[22px] pt-[22px] pb-[22px] text-center">
          {/* Encoches latérales du ticket. */}
          <span className="absolute bottom-[-12px] -left-[11px] size-[22px] rounded-full bg-[#f2f2f2]" />
          <span className="absolute -right-[11px] bottom-[-12px] size-[22px] rounded-full bg-[#f2f2f2]" />
          <QrScanner
            onScan={handleScannedText}
            oneShot={false}
            className="mx-auto max-w-[190px] rounded-[10px]"
          />
          <div className="mt-3.5 text-[11px] font-bold tracking-[0.8px] text-[#757575] uppercase">
            📷 Scanner le QR du client
          </div>
        </div>
        <div className="px-[22px] py-[18px]">
          <InfoLine label="Client" value={customerName ?? "Client"} />
          <InfoLine label="Commande" value={`#${orderRef}`} />
          <InfoLine label="Paiement" value={paymentLabel} />
        </div>
      </div>

      {/* Saisie manuelle du code. */}
      <div className="mt-5 mb-3 text-center text-[11px] font-bold tracking-[1.5px] text-[#757575]">
        OU SAISIR LE CODE
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.focus()}
        className="relative mx-auto flex w-full justify-center gap-2 px-3.5"
        aria-label="Saisir le code à 6 chiffres"
      >
        {boxes.map((d, i) => {
          const filled = d !== "";
          const cur = !filled && i === curIdx;
          return (
            <span
              key={i}
              className={
                "grid h-[50px] w-[40px] place-items-center rounded-[10px] bg-white text-[22px] font-extrabold text-[#0a0a0a] " +
                (filled
                  ? "border-2 border-[#0a0a0a]"
                  : cur
                    ? "border-2 border-[#5c5ce0]"
                    : "border-[1.5px] border-[#e5e5e5]")
              }
            >
              {d}
            </span>
          );
        })}
        {/* Input réel transparent, capte la frappe / clavier numérique. */}
        <input
          ref={inputRef}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
          }
          disabled={pending}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </button>

      {/* CTA */}
      <div className="mt-5 px-4">
        <button
          type="button"
          onClick={onValidateClick}
          disabled={ctaDisabled}
          className="flex w-full items-center justify-center gap-2 rounded-[13px] bg-[#0a0a0a] py-[17px] text-base font-extrabold text-white active:scale-[0.99] disabled:opacity-50"
        >
          {pending && <Loader2 className="size-5 animate-spin" />}
          Valider la livraison
        </button>
      </div>

      {/* Warning rouge selon le paiement. */}
      <div className="mx-4 mt-3 flex items-center gap-2 rounded-[11px] bg-[#fff3f2] px-3.5 py-3 text-xs font-semibold text-[#b22a1f]">
        {isOnline
          ? "⚠ Le code est obligatoire pour cette livraison"
          : "⚠ Cash · le client doit te donner son code de retrait"}
      </div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-[7px] text-[13px]">
      <span className="font-medium text-[#757575]">{label}</span>
      <b className="font-bold text-[#0a0a0a]">{value}</b>
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
