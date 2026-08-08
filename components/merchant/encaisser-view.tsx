"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, QrCode, RefreshCw } from "lucide-react";
import { QrZoom } from "@/components/shared/qr-zoom";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { formatDA } from "@/lib/utils";
import {
  createPayRequest,
  getPayRequestStatus,
} from "@/app/(merchant)/encaisser/actions";

// =============================================================================
// EncaisserView — encaissement Coligo Pay par QR (commerçant). UI FR.
// =============================================================================
// Saisie du montant → génération d'un QR (token usage unique, expire en 15 min)
// → le client le scanne et paie → polling jusqu'au paiement → écran « payé ».
// L'argent (vente − commission) crédite le wallet marchand côté serveur.
// =============================================================================

const PRESETS = [100, 200, 500, 1000];

type Step = "amount" | "qr" | "paid";

export function EncaisserView() {
  const [step, setStep] = useState<Step>("amount");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useActionNote();

  const [req, setReq] = useState<{
    token: string;
    requestId: string;
    expiresAt: string;
    amountDa: number;
  } | null>(null);
  const [paidAmount, setPaidAmount] = useState(0);

  async function generate() {
    const value = Math.floor(Number(amount));
    if (!Number.isFinite(value) || value < 10) {
      setNote({ ok: false, text: "Montant minimum : 10 DA." });
      return;
    }
    setBusy(true);
    const res = await createPayRequest(value);
    setBusy(false);
    if (!res.ok) {
      setNote({
        ok: false,
        text:
          res.error === "below_min"
            ? "Montant minimum : 10 DA."
            : "Impossible de générer le QR. Réessaie.",
      });
      return;
    }
    setReq({
      token: res.token,
      requestId: res.requestId,
      expiresAt: res.expiresAt,
      amountDa: value,
    });
    setStep("qr");
  }

  function reset() {
    setReq(null);
    setAmount("");
    setPaidAmount(0);
    setStep("amount");
  }

  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="bg-primary-50 text-primary-600 grid size-11 place-items-center rounded-xl">
          <QrCode className="size-5" />
        </div>
        <div>
          <h1 className="text-foreground text-xl font-black tracking-tight">
            Encaisser par QR
          </h1>
          <p className="text-muted text-xs font-medium">
            Paiement Coligo Pay en magasin
          </p>
        </div>
      </div>

      {step === "amount" && (
        <div className="border-border bg-surface rounded-xl border p-5">
          <label className="text-muted text-caption-lg font-extrabold tracking-wide uppercase">
            Montant à encaisser
          </label>
          <div className="border-border bg-surface-2 focus-within:border-primary-400 rounded-card-lg mt-2 flex items-center gap-2 border px-4 py-3.5">
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) =>
                setAmount(e.target.value.replace(/\D/g, "").slice(0, 7))
              }
              placeholder="0"
              autoFocus
              className="text-foreground w-full bg-transparent text-2xl font-black tabular-nums outline-none"
            />
            <span className="text-muted shrink-0 text-sm font-bold">DA</span>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(String(p))}
                className="border-border hover:border-primary-300 rounded-md border py-2.5 text-sm font-bold tabular-nums"
              >
                {p}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || amount === ""}
            onClick={generate}
            className="bg-primary-600 hover:bg-primary-700 rounded-card-lg text-title-sm mt-4 inline-flex h-12 w-full items-center justify-center gap-2 font-extrabold text-white disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <>
                <QrCode className="size-5" />
                Générer le QR
              </>
            )}
          </button>
          <ActionNote note={note} className="text-body-sm mt-2 text-center" />
        </div>
      )}

      {step === "qr" && req && (
        <QrWaiting
          req={req}
          onPaid={(amt) => {
            setPaidAmount(amt);
            setStep("paid");
          }}
          onExpired={reset}
          onCancel={reset}
        />
      )}

      {step === "paid" && (
        <div className="border-border bg-surface rounded-xl border p-7 text-center">
          <div className="bg-success-100 text-success-700 mx-auto grid size-16 place-items-center rounded-full">
            <Check className="size-9" />
          </div>
          <p className="text-foreground mt-4 text-xl font-black">
            Paiement reçu
          </p>
          <p className="text-primary-600 mt-2 text-[34px] leading-none font-black tabular-nums">
            {formatDA(paidAmount)}
          </p>
          <p className="text-muted text-body-sm mt-2 font-medium">
            Crédité sur ton solde Coligo (vente − commission).
          </p>
          <button
            type="button"
            onClick={reset}
            className="bg-primary-600 hover:bg-primary-700 rounded-card-lg text-title-sm mt-6 inline-flex h-12 w-full items-center justify-center gap-2 font-extrabold text-white"
          >
            <RefreshCw className="size-4" />
            Nouvel encaissement
          </button>
        </div>
      )}
    </div>
  );
}

function QrWaiting({
  req,
  onPaid,
  onExpired,
  onCancel,
}: {
  req: {
    token: string;
    requestId: string;
    expiresAt: string;
    amountDa: number;
  };
  onPaid: (amountDa: number) => void;
  onExpired: () => void;
  onCancel: () => void;
}) {
  const [remaining, setRemaining] = useState<number>(() =>
    Math.max(
      0,
      Math.floor((new Date(req.expiresAt).getTime() - Date.now()) / 1000)
    )
  );
  const onPaidRef = useRef(onPaid);
  const onExpiredRef = useRef(onExpired);
  onPaidRef.current = onPaid;
  onExpiredRef.current = onExpired;

  // Polling du statut (2,5 s) + arrêt au paiement / à l'expiration.
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      const st = await getPayRequestStatus(req.requestId);
      if (stopped) return;
      if (st?.status === "consumed") {
        onPaidRef.current(st.amountDa);
      }
    };
    const id = setInterval(poll, 2500);
    void poll();
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [req.requestId]);

  // Compte à rebours d'expiration.
  useEffect(() => {
    const id = setInterval(() => {
      const r = Math.max(
        0,
        Math.floor((new Date(req.expiresAt).getTime() - Date.now()) / 1000)
      );
      setRemaining(r);
      if (r <= 0) {
        clearInterval(id);
        onExpiredRef.current();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [req.expiresAt]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className="border-border bg-surface rounded-xl border p-6 text-center">
      <p className="text-muted text-label font-bold tracking-wide uppercase">
        À encaisser
      </p>
      <p className="text-foreground mt-1 text-[34px] leading-none font-black tabular-nums">
        {formatDA(req.amountDa)}
      </p>

      <div className="mt-5 flex justify-center">
        <QrZoom
          value={req.token}
          size={220}
          caption="Fais scanner ce QR au client"
        />
      </div>

      <p className="text-foreground mt-4 text-sm font-bold">
        Fais scanner ce QR au client
      </p>
      <p className="text-muted mt-1 text-xs font-medium">
        Ou code : <span className="text-foreground font-bold">{req.token}</span>
      </p>

      <div className="text-muted mt-4 inline-flex items-center gap-2 text-xs font-bold">
        <Loader2 className="text-primary-600 size-4 animate-spin" />
        En attente du paiement · expire dans{" "}
        <span className="tabular-nums">
          {mm}:{ss}
        </span>
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="text-muted mt-5 block w-full text-sm font-bold"
      >
        Annuler
      </button>
    </div>
  );
}
