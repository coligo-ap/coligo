"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import {
  updateOrderRules,
  type SettingsFormState,
} from "@/app/(merchant)/settings/actions";
import type { MerchantSettings } from "@/lib/types";

const initial: SettingsFormState = {};

const SLOT_OPTIONS = [5, 10, 15, 20, 30, 60];

export function OrderRulesForm({ merchant }: { merchant: MerchantSettings }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    updateOrderRules,
    initial
  );
  const btnState = useFormActionFeedback({
    pending,
    ok: state.ok,
    error: state.error,
  });

  useEffect(() => {
    if (state.ok && !pending) router.refresh();
  }, [state.ok, pending, router]);

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Minimum de commande (DA)" hint="0 = pas de minimum">
          <Input
            type="number"
            name="min_order_da"
            defaultValue={merchant.min_order_da}
            min={0}
            step={50}
            disabled={pending}
          />
        </Field>
        <Field
          label="Délai de préparation par défaut (min)"
          hint="Calculé pour le créneau le plus tôt proposé au client"
        >
          <Input
            type="number"
            name="prep_time_min"
            defaultValue={merchant.prep_time_min}
            min={0}
            max={600}
            step={5}
            disabled={pending}
          />
        </Field>
      </div>

      <div className="border-border bg-surface-2 rounded-[12px] border p-4">
        <p className="text-foreground mb-3 text-sm font-semibold">
          Modes de paiement acceptés
        </p>
        <div className="space-y-2">
          <Toggle
            name="accepts_cash"
            label="Espèces (à la récupération)"
            description="Le client paie en main propre lors du retrait."
            defaultChecked={merchant.accepts_cash}
            disabled={pending}
          />
          <Toggle
            name="accepts_online"
            label="Paiement en ligne (carte CIB / EDAHABIA)"
            description="Le client paie via Chargily à la commande."
            defaultChecked={merchant.accepts_online}
            disabled={pending}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Granularité des créneaux de retrait"
          hint="Pas de temps proposé au client (en minutes)"
        >
          <select
            name="pickup_slot_minutes"
            defaultValue={merchant.pickup_slot_minutes}
            disabled={pending}
            className="border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 h-12 w-full rounded-[12px] border px-4 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
          >
            {SLOT_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Capacité par créneau"
          hint="Nombre max de commandes acceptées sur un même créneau (vide = illimité)"
        >
          <Input
            type="number"
            name="max_orders_per_slot"
            defaultValue={merchant.max_orders_per_slot ?? ""}
            min={1}
            step={1}
            placeholder="Illimité"
            disabled={pending}
          />
        </Field>
      </div>

      {state.error && btnState === "error" && (
        <p className="text-danger-600 text-sm">{state.error}</p>
      )}

      <ActionButton
        type="submit"
        state={btnState}
        labels={{
          idle: "Enregistrer les règles",
          pending: "Enregistrement…",
          success: "Règles enregistrées ✓",
          error: "Erreur, réessaie",
        }}
      />
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-subtle text-xs">{hint}</p>}
    </div>
  );
}

function Toggle({
  name,
  label,
  description,
  defaultChecked,
  disabled,
}: {
  name: string;
  label: string;
  description?: string;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="hover:bg-surface flex cursor-pointer items-start gap-3 rounded-[10px] p-2 transition-colors">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="accent-primary-600 mt-0.5 size-4"
      />
      <span className="flex-1">
        <span className="text-foreground block text-sm font-medium">
          {label}
        </span>
        {description && (
          <span className="text-muted block text-xs">{description}</span>
        )}
      </span>
    </label>
  );
}
