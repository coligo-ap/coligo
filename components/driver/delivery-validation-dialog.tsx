"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
  arrivedAt,
  noShowWaitMin = 8,
  onClose,
  onSuccess,
}: {
  orderId: string;
  orderNumber?: string | null;
  paymentMethod: "cash" | "online";
  customerName?: string | null;
  totalDa?: number | null;
  /** delivery_arrived_at de la commande — démarre le minuteur no-show. */
  arrivedAt?: string | null;
  /** Fenêtre d'attente avant no-show (min). Doublée côté serveur si le client
   *  n'a pas répondu en messagerie. */
  noShowWaitMin?: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const isOnline = paymentMethod === "online";
  const collect = isOnline ? 0 : (totalDa ?? 0);

  // Minuteur no-show : le livreur ne peut signaler un client absent qu'après
  // `noShowWaitMin` minutes depuis son ARRIVÉE (le serveur étend à ×2 si le
  // client n'a pas répondu en messagerie). Tick chaque seconde.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const arrivedMs = arrivedAt ? new Date(arrivedAt).getTime() : null;
  const noShowReadyAt = arrivedMs ? arrivedMs + noShowWaitMin * 60_000 : null;
  const noShowRemainingMs = noShowReadyAt
    ? Math.max(0, noShowReadyAt - now)
    : null;
  const noShowReady = arrivedMs != null && noShowRemainingMs === 0;
  const mmss = (ms: number) => {
    const s = Math.ceil(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

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
    if (code.length >= 4) return submit(false);
    if (confirm("Confirmer la remise au client (paiement cash) ?"))
      submit(true);
  };

  // No-show / refus (règle Yassir, mig 0162) : commande annulée. Espèces →
  // seule l'avance est remboursable (validation support), course non payée.
  // Online payé → course payée normalement (le client a déjà tout réglé).
  const onNoShow = () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("Connexion requise pour signaler un client absent.");
      return;
    }
    if (!noShowReady) return; // bouton déjà désactivé, garde-fou
    if (
      !confirm(
        "Client absent ou commande refusée ?\n\n" +
          "Vérifie que tu as bien CONTACTÉ le client (message) et attendu sur place. " +
          "La commande sera ANNULÉE." +
          (isOnline
            ? " Ta course est payée normalement (commande déjà payée en ligne)."
            : "\n\nTon avance au commerçant sera remboursée APRÈS validation du " +
              "support — la course n'est pas payée (règle no-show). GARDE la " +
              "commande avec toi : le support te dira quoi en faire (retour, " +
              "garder ou donner). Suivi dans Relevé.")
      )
    )
      return;
    start(async () => {
      const r = await reportNoShow({ orderId, reason: "no_show" });
      if (!r.ok) {
        toast.error(reasonLabel(r.reason));
        return;
      }
      toast.success(
        isOnline
          ? "Signalé — commande annulée, ta course est payée."
          : "Signalé — le support examine le remboursement de ton avance (voir Relevé)."
      );
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
          <div className="am">{isOnline ? "0" : collect} DA</div>
        </div>

        <button
          type="button"
          className="mq-btn"
          onClick={onValidateClick}
          disabled={ctaDisabled}
          style={ctaDisabled ? { opacity: 0.5 } : undefined}
        >
          {pending ? "Validation…" : "Valider la livraison"}
        </button>

        {/* Client absent / refus — minuteur 8 min depuis l'arrivée avant
            activation (le serveur étend à ×2 si le client n'a pas répondu). */}
        {noShowReady ? (
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
        ) : (
          <div
            style={{
              width: "100%",
              marginTop: 10,
              padding: "11px 12px",
              borderRadius: 14,
              border: "1.5px dashed #d0d5dd",
              background: "#f9fafb",
              color: "#667085",
              fontWeight: 600,
              fontSize: 12.5,
              textAlign: "center",
              lineHeight: 1.45,
            }}
          >
            {arrivedMs == null ? (
              <>Signale ton arrivée pour démarrer le minuteur d&apos;attente.</>
            ) : (
              <>
                « Client absent » disponible dans{" "}
                <strong style={{ color: "#b42318" }}>
                  {mmss(noShowRemainingMs ?? 0)}
                </strong>
                . Contacte le client via la messagerie en attendant.
              </>
            )}
          </div>
        )}
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
    case "not_arrived":
      return "Signale ton arrivée avant de déclarer un client absent.";
    case "too_early":
      return "Patiente encore : contacte le client, le délai d'attente n'est pas écoulé.";
    default:
      return reason ?? "Erreur";
  }
}
