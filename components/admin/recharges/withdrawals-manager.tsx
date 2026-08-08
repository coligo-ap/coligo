"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { payWithdrawal, rejectWithdrawal } from "@/app/admin/recharges/actions";

export type PendingWithdrawal = {
  id: string;
  ownerLabel: string;
  ownerType: string;
  method: string;
  amountDa: number;
  destination: string;
  destinationName: string | null;
  balanceDa: number;
  createdAt: string;
};

function grp(n: number) {
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Demandes de RETRAIT Coligo Pay (chauffeur / livreur, mig 0384). « Payer »
 * confirme en 2 taps puis débite le portefeuille (écriture `payout`, garde de
 * solde serveur). « Refuser » exige un motif — il est montré au partenaire.
 * États par LIGNE (jamais de blocage global).
 */
export function WithdrawalsManager({ rows }: { rows: PendingWithdrawal[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="border-border bg-surface mt-4 rounded-lg border p-5">
      <h2 className="text-foreground text-base font-bold">
        Demandes de retrait Coligo Pay
        <span className="bg-warning-100 text-warning-700 ml-2 rounded-full px-2 py-0.5 text-xs font-bold">
          {rows.length}
        </span>
      </h2>
      <p className="text-muted mb-3 text-sm">
        Versez le montant sur le compte indiqué puis « Payer » : le solde du
        partenaire est débité à ce moment-là (contrôle de solde serveur).
      </p>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <WithdrawalRow key={r.id} r={r} />
        ))}
      </div>
    </section>
  );
}

function WithdrawalRow({ r }: { r: PendingWithdrawal }) {
  const [payArmed, setPayArmed] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"pay" | "reject" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<"paid" | "rejected" | null>(null);

  const doPay = async () => {
    if (busy) return;
    setBusy("pay");
    setErr(null);
    const res = await payWithdrawal(r.id);
    setBusy(null);
    if (res.error) setErr(res.error);
    else setDone("paid");
  };
  const doReject = async () => {
    if (busy || !note.trim()) return;
    setBusy("reject");
    setErr(null);
    const res = await rejectWithdrawal(r.id, note.trim());
    setBusy(null);
    if (res.error) setErr(res.error);
    else setDone("rejected");
  };

  if (done) {
    return (
      <div className="border-border text-muted rounded-md border border-dashed px-3 py-2.5 text-sm">
        {done === "paid" ? "✓ Payée" : "Refusée"} — {r.ownerLabel} ·{" "}
        {grp(r.amountDa)} DA
      </div>
    );
  }

  return (
    <div className="border-border rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <b className="text-sm">{r.ownerLabel}</b>
        <span className="text-muted text-xs">
          {r.ownerType === "chauffeur" ? "Chauffeur" : "Livreur"}
        </span>
        <span className="text-sm font-extrabold">{grp(r.amountDa)} DA</span>
        <span className="text-muted text-xs">
          {r.method === "baridimob" ? "BaridiMob" : "Virement CCP"} →{" "}
          {r.destination}
          {r.destinationName ? ` (${r.destinationName})` : ""}
        </span>
        <span className="text-muted text-xs">
          Solde : {grp(r.balanceDa)} DA ·{" "}
          {new Date(r.createdAt).toLocaleDateString("fr-DZ", {
            timeZone: "Africa/Algiers",
          })}
        </span>
        <span className="flex-1" />
        {!rejecting && (
          <>
            <button
              type="button"
              disabled={busy != null}
              onClick={() => (payArmed ? void doPay() : setPayArmed(true))}
              className="bg-success-600 hover:bg-success-700 rounded-control inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy === "pay" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              {payArmed ? "Confirmer le paiement ?" : "Payer"}
            </button>
            <button
              type="button"
              disabled={busy != null}
              onClick={() => {
                setPayArmed(false);
                setRejecting(true);
              }}
              className="border-border text-danger-600 rounded-control inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              <X className="size-3.5" />
              Refuser
            </button>
          </>
        )}
      </div>
      {rejecting && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Motif du refus (montré au partenaire)"
            className="border-border rounded-control min-w-[240px] flex-1 border px-3 py-1.5 text-sm outline-none"
          />
          <button
            type="button"
            disabled={busy != null || !note.trim()}
            onClick={() => void doReject()}
            className="bg-danger-600 rounded-control inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy === "reject" && <Loader2 className="size-3.5 animate-spin" />}
            Confirmer le refus
          </button>
          <button
            type="button"
            disabled={busy != null}
            onClick={() => setRejecting(false)}
            className="text-muted text-xs font-semibold"
          >
            Annuler
          </button>
        </div>
      )}
      {err && <p className="text-danger-600 mt-1.5 text-xs">{err}</p>}
    </div>
  );
}
