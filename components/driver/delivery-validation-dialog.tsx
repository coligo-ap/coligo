"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "@/components/ui/toast";
import { QrScanner } from "@/components/scanner/qr-scanner";
import { enqueueValidation } from "@/lib/driver-offline/db";
import { validateDelivery, reportNoShow } from "@/app/(driver)/actions";

/**
 * Écran VALIDATION DE REMISE reproduit À L'IDENTIQUE de MAQUETTE-livreur-pages
 * (.valid) : titre + sous-titre, zone .qr (scanner caméra), « — ou — », code en
 * cases (.pinrow), encart vert .cash « Espèces à encaisser », bouton .mq-btn.
 *
 * Logique métier anti-fraude inchangée (mig 0041/0090) :
 *  - online/prépayé : code OBLIGATOIRE.
 *  - cash : code encouragé, validation possible sans code (tracée).
 * Le QR encode le pickup_code (4 chiffres ; tolérance legacy 6). Mode hors-ligne
 * (enqueue + synchro) conservé. Chemins scan et saisie unifiés côté serveur.
 */
export function DeliveryValidationDialog({
  orderId,
  paymentMethod,
  totalDa,
  onClose,
  onSuccess,
}: {
  orderId: string;
  orderNumber?: string | null;
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
  const collect = isOnline ? 0 : (totalDa ?? 0);
  // Montant ESPÈCES réellement encaissé — éditable (appoint manquant, mig 0114).
  // Saisie en DA ; défaut = montant dû. < dû → l'écart devient une créance client.
  const [collected, setCollected] = useState<string>(String(collect));
  const collectedNum = Math.max(0, Math.floor(Number(collected) || 0));
  const shortfall = isOnline ? 0 : Math.max(0, collect - collectedNum);

  const submit = (skip: boolean) =>
    start(async () => {
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
        collectedDa: isOnline ? null : collectedNum,
      });
      if (!r.ok) {
        if (
          r.reason &&
          [
            "bad_code",
            "online_requires_code",
            "code_required",
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
    const digits = text.match(/\d{4,6}/)?.[0];
    if (digits) {
      setCode(digits.slice(0, 4));
      toast.success("Code détecté");
    }
  };

  const onValidateClick = () => {
    if (isOnline) return submit(false);
    // Cash : avertir si appoint manquant (écart imputé en créance au client).
    if (shortfall > 0) {
      if (
        !confirm(
          `Le client n'a payé que ${collectedNum} DA sur ${collect} DA.\n` +
            `L'écart de ${shortfall} DA sera porté en créance sur sa prochaine commande.\n\n` +
            `Confirmer la remise ?`
        )
      )
        return;
      return code.length >= 4 ? submit(false) : submit(true);
    }
    if (code.length >= 4) return submit(false);
    if (confirm("Confirmer la remise au client (paiement cash) ?"))
      submit(true);
  };

  // No-show / refus : commande annulée, livreur indemnisé, client perd le COD.
  const onNoShow = () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("Connexion requise pour signaler un client absent.");
      return;
    }
    if (
      !confirm(
        "Client absent ou commande refusée ?\n\n" +
          "La commande sera ANNULÉE et renvoyée au commerçant. Tu seras indemnisé " +
          "d'une course. Le client perdra le paiement en espèces. À n'utiliser " +
          "qu'après avoir réellement tenté la remise."
      )
    )
      return;
    start(async () => {
      const r = await reportNoShow({ orderId, reason: "no_show" });
      if (!r.ok) {
        toast.error(reasonLabel(r.reason));
        return;
      }
      toast.success("Signalé — commande annulée, tu es indemnisé.");
      onSuccess();
    });
  };

  const ctaDisabled = pending || (isOnline && code.length < 4);
  const boxes = Array.from({ length: 4 }, (_, i) => code[i] ?? "");
  const curIdx = Math.min(code.length, 3);

  return (
    <div className="mq-screen fixed inset-0 z-[95] overflow-auto">
      <div className="valid">
        <div className="backh" style={{ margin: "2px 0 6px" }}>
          <button
            type="button"
            className="b"
            onClick={onClose}
            aria-label="Retour"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>

        <h2>Confirmer la remise</h2>
        <p>Scannez le QR du client ou saisissez son code.</p>

        <div className="qr" style={{ overflow: "hidden" }}>
          <QrScanner
            onScan={handleScannedText}
            oneShot={false}
            className="size-full rounded-[20px]"
          />
        </div>

        <div className="or">— ou —</div>

        <button
          type="button"
          onClick={() => inputRef.current?.focus()}
          className="pinrow"
          style={{ position: "relative", width: "100%" }}
          aria-label="Saisir le code"
        >
          {boxes.map((d, i) => {
            const filled = d !== "";
            const cur = !filled && i === curIdx;
            return (
              <span key={i} className={"c" + (filled || cur ? " f" : "")}>
                {d}
              </span>
            );
          })}
          <input
            ref={inputRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={4}
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            disabled={pending}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </button>

        <div className="cash">
          <div className="l">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
            {isOnline ? "Déjà payé en ligne" : "Espèces à encaisser"}
          </div>
          {isOnline ? (
            <div className="am">0 DA</div>
          ) : (
            <div
              className="am"
              style={{ display: "flex", alignItems: "center", gap: 4 }}
            >
              <input
                inputMode="numeric"
                value={collected}
                onChange={(e) =>
                  setCollected(e.target.value.replace(/\D/g, "").slice(0, 7))
                }
                disabled={pending}
                aria-label="Montant encaissé"
                style={{
                  width: `${Math.max(2, collected.length)}ch`,
                  background: "transparent",
                  border: "none",
                  borderBottom: "2px solid currentColor",
                  textAlign: "right",
                  font: "inherit",
                  color: "inherit",
                  padding: 0,
                }}
              />
              <span>DA</span>
            </div>
          )}
        </div>

        {/* Appoint manquant : écart visible avant validation (mig 0114). */}
        {!isOnline && shortfall > 0 && (
          <p
            style={{
              margin: "6px 2px 0",
              fontSize: 12.5,
              fontWeight: 700,
              color: "#b54708",
            }}
          >
            Appoint manquant : {shortfall} DA porté en créance au client (à
            recouvrer à sa prochaine commande).
          </p>
        )}

        <button
          type="button"
          className="mq-btn"
          onClick={onValidateClick}
          disabled={ctaDisabled}
          style={ctaDisabled ? { opacity: 0.5 } : undefined}
        >
          {pending ? "Validation…" : "Valider la livraison"}
        </button>

        {/* Client absent / refus — action secondaire, discrète mais accessible. */}
        <button
          type="button"
          onClick={onNoShow}
          disabled={pending}
          style={{
            width: "100%",
            marginTop: 10,
            padding: "11px 12px",
            borderRadius: 14,
            border: "1.5px solid #fda29b",
            background: "#fffbfa",
            color: "#b42318",
            fontWeight: 700,
            fontSize: 14,
            opacity: pending ? 0.5 : 1,
          }}
        >
          Client absent / commande refusée
        </button>
      </div>
    </div>
  );
}

function reasonLabel(reason?: string): string {
  switch (reason) {
    case "online_requires_code":
      return "Code requis pour les commandes payées en ligne.";
    case "code_required":
      return "Code obligatoire : commande prépayée. Le client doit te communiquer son code.";
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
    case "already_closed":
      return "Commande déjà clôturée.";
    case "not_picked_up":
      return "Récupère d'abord la commande chez le commerçant.";
    default:
      return reason ?? "Erreur";
  }
}
