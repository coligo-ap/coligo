"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { PAYOUT_METHODS } from "@/lib/types";
import {
  updatePayoutSettings,
  type SettingsResult,
} from "@/app/(merchant)/settings/actions";

const initial: SettingsResult = {};

/**
 * Réglages de versement : cadence (manuel / hebdo / mensuel) + méthode + RIB.
 * En auto, le solde disponible est versé automatiquement (le cron crée la
 * demande ; l'admin exécute le virement). Méthode + coordonnées requises en auto.
 */
export function PayoutSettingsForm({
  payoutAuto,
  payoutMethod,
  payoutDetails,
}: {
  payoutAuto: "none" | "weekly" | "monthly";
  payoutMethod: string | null;
  payoutDetails: string | null;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    updatePayoutSettings,
    initial
  );
  const [auto, setAuto] = useState(payoutAuto);

  useEffect(() => {
    if (state.ok) {
      toast.success(state.success ?? "Enregistré");
      router.refresh();
    }
  }, [state, router]);

  const autoOn = auto !== "none";

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label>Fréquence de versement</Label>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["none", "À la demande"],
              ["weekly", "Hebdomadaire"],
              ["monthly", "Mensuel"],
            ] as const
          ).map(([val, label]) => (
            <label
              key={val}
              className={
                "cursor-pointer rounded-[12px] border px-3 py-2.5 text-center text-sm font-semibold transition-colors " +
                (auto === val
                  ? "border-primary-400 bg-primary-50 text-primary-700"
                  : "border-border text-muted hover:bg-surface-2")
              }
            >
              <input
                type="radio"
                name="payout_auto"
                value={val}
                checked={auto === val}
                onChange={() => setAuto(val)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
        <p className="text-subtle text-xs">
          En auto, votre solde disponible est versé automatiquement (min. 1000
          DA) ; vous pouvez toujours demander un versement à tout moment.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>
          Méthode {autoOn && <span className="text-rose-600">*</span>}
        </Label>
        <select
          name="payout_method"
          defaultValue={payoutMethod ?? "ccp"}
          disabled={pending}
          className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 h-12 w-full rounded-[12px] border px-4 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
        >
          {PAYOUT_METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label>
          Coordonnées (n° CCP / RIB)
          {autoOn && <span className="text-rose-600"> *</span>}
        </Label>
        <Input
          name="payout_details"
          defaultValue={payoutDetails ?? ""}
          placeholder="Ex. CCP 00799999 clé 25"
          disabled={pending}
        />
      </div>

      {state.error && <p className="text-danger-600 text-sm">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Banknote className="size-4" />
        )}
        Enregistrer
      </Button>
    </form>
  );
}
