"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import {
  updateLoyaltyBounds,
  type LoyaltyBoundsResult,
} from "@/app/admin/merchants/fidelite/actions";

export type LoyaltyBounds = {
  min_earn_rate_pct: number | string;
  max_earn_rate_pct: number | string;
  min_tier_threshold_da: number;
  max_tier_reward_da: number;
  max_daily_credit_cap_da: number;
  max_link_bonus_da: number;
  min_voucher_validity_days: number;
  max_voucher_validity_days: number;
  max_purchase_per_credit_da: number;
  max_batch_quantity: number;
};

const initial: LoyaltyBoundsResult = {};

const FIELDS: { name: keyof LoyaltyBounds; label: string; hint: string }[] = [
  {
    name: "min_earn_rate_pct",
    label: "Taux cashback min (%)",
    hint: "Plancher du taux qu'un commerçant peut choisir.",
  },
  {
    name: "max_earn_rate_pct",
    label: "Taux cashback max (%)",
    hint: "Plafond du taux (protège la cohérence des prix).",
  },
  {
    name: "min_tier_threshold_da",
    label: "Seuil de palier min (DA)",
    hint: "Un palier trop bas génère des bons en rafale.",
  },
  {
    name: "max_tier_reward_da",
    label: "Bon de palier max (DA)",
    hint: "Valeur maximale d'un bon débloqué.",
  },
  {
    name: "max_daily_credit_cap_da",
    label: "Plafond client / 24 h max (DA)",
    hint: "Borne du garde-fou anti-fraude par compte.",
  },
  {
    name: "max_link_bonus_da",
    label: "Bonus de liaison max (DA)",
    hint: "Cadeau max à la liaison d'une carte.",
  },
  {
    name: "min_voucher_validity_days",
    label: "Validité des bons min (jours)",
    hint: "Un bon ne peut pas expirer plus tôt.",
  },
  {
    name: "max_voucher_validity_days",
    label: "Validité des bons max (jours)",
    hint: "Durée de vie maximale d'un bon.",
  },
  {
    name: "max_purchase_per_credit_da",
    label: "Achat max par crédit (DA)",
    hint: "Anti-faute de frappe en caisse.",
  },
  {
    name: "max_batch_quantity",
    label: "Taille max d'un lot de cartes",
    hint: "Cartes imprimables par lot PDF.",
  },
];

/** Bornes plateforme du programme de fidélité (une config hors bornes est
 *  impossible — RPC + trigger DB, pas seulement l'UI). */
export function LoyaltyBoundsForm({ bounds }: { bounds: LoyaltyBounds }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(updateLoyaltyBounds, initial);
  const fb = useFormActionFeedback({
    pending,
    ok: state.ok,
    error: state.error,
  });

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.name} className="space-y-1.5">
            <Label htmlFor={f.name}>{f.label}</Label>
            <Input
              id={f.name}
              name={f.name}
              inputMode="decimal"
              defaultValue={String(bounds[f.name])}
              disabled={pending}
            />
            <p className="text-subtle text-xs">{f.hint}</p>
          </div>
        ))}
      </div>

      {state.error && <p className="text-danger-600 text-sm">{state.error}</p>}

      <ActionButton
        type="submit"
        state={fb}
        idleIcon={<ShieldCheck className="size-4" />}
        labels={{ idle: "Enregistrer les bornes", success: "Enregistré ✓" }}
      />
    </form>
  );
}
