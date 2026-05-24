"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { formatDA, cn } from "@/lib/utils";
import { createTopup } from "@/app/(customer)/cashback/actions";

// =============================================================================
// ColigoPayCard — encart « Coligo Pay » sur /cashback.
// =============================================================================
// Affiche le solde topup + bouton "Recharger" → modale avec montants
// prédéfinis + montant libre. Confirmation : redirige vers Chargily.
// Le crédit n'apparaît qu'après confirmation par le webhook (RLS-Realtime
// peut faire apparaître la ligne en temps réel sur la page).
//
// Le plafond glissant est vérifié serveur — on n'affiche pas son détail ici
// (on l'apprend via le message d'erreur si dépassé).
// =============================================================================

const PRESETS = [500, 1000, 2000, 5000];

export function ColigoPayCard({
  balanceDa,
  remaining30d,
  maxPerRecharge,
}: {
  balanceDa: number;
  remaining30d: number;
  maxPerRecharge: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <section className="border-border bg-surface relative mt-4 overflow-hidden rounded-[16px] border p-5">
        <Sparkles className="text-primary-200 absolute -top-2 -right-2 size-24 opacity-50" />
        <p className="text-primary-700 text-xs font-semibold tracking-wider uppercase">
          Coligo Pay
        </p>
        <p className="text-foreground mt-1 text-3xl font-bold tabular-nums lg:text-4xl">
          {formatDA(balanceDa)}
        </p>
        <p className="text-muted mt-2 max-w-md text-xs">
          Recharge ton compte par carte CIB/EDAHABIA pour payer tes commandes
          plus vite. Solde réel — tu peux l&apos;utiliser quand tu veux.
        </p>
        <Button
          type="button"
          size="lg"
          className="mt-4"
          onClick={() => setOpen(true)}
        >
          Recharger
        </Button>
      </section>
      {open && (
        <TopupModal
          onClose={() => setOpen(false)}
          remaining30d={remaining30d}
          maxPerRecharge={maxPerRecharge}
        />
      )}
    </>
  );
}

function TopupModal({
  onClose,
  remaining30d,
  maxPerRecharge,
}: {
  onClose: () => void;
  remaining30d: number;
  maxPerRecharge: number;
}) {
  const [amount, setAmount] = useState<number>(1000);
  const [custom, setCustom] = useState<string>("");
  const [pending, start] = useTransition();
  const cap = Math.min(maxPerRecharge, remaining30d);

  function submit() {
    const value = custom ? Number(custom) : amount;
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Saisis un montant valide.");
      return;
    }
    start(async () => {
      const res = await createTopup(value);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      window.location.href = res.checkout_url;
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface w-full max-w-md rounded-t-[20px] p-5 sm:rounded-[20px]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-foreground text-lg font-bold">
            Recharger Coligo Pay
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label="Fermer"
          >
            <X className="size-5" />
          </button>
        </header>

        <p className="text-muted mb-3 text-xs">
          Plafond restant sur 30 jours :{" "}
          <span className="text-foreground font-medium tabular-nums">
            {formatDA(remaining30d)}
          </span>
        </p>

        <div className="mb-3 grid grid-cols-2 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={p > cap}
              onClick={() => {
                setAmount(p);
                setCustom("");
              }}
              className={cn(
                "rounded-[12px] border px-3 py-3 text-sm font-semibold tabular-nums transition disabled:cursor-not-allowed disabled:opacity-50",
                amount === p && !custom
                  ? "border-primary-600 bg-primary-600 text-white"
                  : "border-border bg-surface hover:border-primary-300"
              )}
            >
              {formatDA(p)}
            </button>
          ))}
        </div>

        <label className="text-foreground text-xs font-semibold tracking-wider uppercase">
          Ou montant libre
        </label>
        <input
          type="number"
          inputMode="numeric"
          min={100}
          max={cap}
          step={100}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Ex. 1500"
          className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 mt-1.5 w-full rounded-[12px] border px-3 py-2 text-sm tabular-nums focus-visible:ring-2 focus-visible:outline-none"
        />

        <Button
          type="button"
          size="lg"
          className="mt-4 w-full"
          onClick={submit}
          disabled={pending || cap <= 0}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            `Payer ${formatDA(custom ? Number(custom) || 0 : amount)} via Chargily`
          )}
        </Button>
        <p className="text-muted mt-3 text-center text-[11px]">
          Tu seras redirigé(e) vers Chargily Pay. Aucun débit avant validation.
        </p>
      </div>
    </div>
  );
}
