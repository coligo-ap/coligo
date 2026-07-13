"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import {
  updateIdvProfileRule,
  type AdminFormState,
} from "@/app/admin/(confiance)/identite/actions";
import type { IdvProfileRule, IdvRequirement } from "@/lib/idv/types";

const initialState: AdminFormState = {};

const REQUIREMENT_OPTIONS: {
  value: IdvRequirement;
  label: string;
  tone: string;
}[] = [
  { value: "required", label: "Obligatoire", tone: "text-danger-700" },
  { value: "optional", label: "Facultatif", tone: "text-primary-700" },
  { value: "disabled", label: "Désactivé", tone: "text-muted" },
];

export type IdvModeOption = { key: string; label_fr: string; enabled: boolean };

/**
 * Règle IDV d'UN profil : exigence, modes autorisés, mode par défaut, libre
 * choix du mode. État local par carte (jamais de blocage global), feedback
 * porté par le bouton + message inline (pas de toast).
 */
export function IdvProfileRuleCard({
  rule,
  modes,
  label,
  hint,
}: {
  rule: IdvProfileRule;
  modes: IdvModeOption[];
  label: string;
  hint: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    updateIdvProfileRule,
    initialState
  );
  const fb = useFormActionFeedback({
    pending,
    ok: state.ok,
    error: state.error,
  });

  const [requirement, setRequirement] = useState<IdvRequirement>(
    rule.requirement
  );
  const [allowed, setAllowed] = useState<string[]>(rule.allowed_modes);
  const [defaultMode, setDefaultMode] = useState(rule.default_mode);
  const [userChoose, setUserChoose] = useState(rule.user_can_choose_mode);
  /** Tant qu'il n'existe qu'un mode, aucun « niveau de vérification » à choisir. */
  const multiMode = modes.length > 1;

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  const toggleMode = (key: string) => {
    setAllowed((prev) => {
      const next = prev.includes(key)
        ? prev.filter((m) => m !== key)
        : [...prev, key];
      // Le mode par défaut doit rester dans la sélection.
      if (!next.includes(defaultMode) && next.length > 0) {
        setDefaultMode(next[0]);
      }
      return next;
    });
  };

  const active = requirement !== "disabled";

  return (
    <form
      action={formAction}
      className="border-border bg-surface space-y-3 rounded-[16px] border p-4"
    >
      <input type="hidden" name="profile" value={rule.profile} />
      <div>
        <p className="font-semibold">{label}</p>
        <p className="text-muted mt-0.5 text-xs leading-relaxed">{hint}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {REQUIREMENT_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={
              "border-border cursor-pointer rounded-[10px] border px-2.5 py-1 text-xs font-medium transition-colors " +
              (requirement === opt.value
                ? `bg-primary-50 border-primary-200 ${opt.tone}`
                : "text-muted hover:bg-surface-2")
            }
          >
            <input
              type="radio"
              name="requirement"
              value={opt.value}
              checked={requirement === opt.value}
              onChange={() => setRequirement(opt.value)}
              className="sr-only"
            />
            {opt.label}
          </label>
        ))}
      </div>

      {/* Un seul mode de vérification existe (le mode COMPLET) : il n'y a rien à
          choisir, et surtout aucun niveau plus faible à proposer. La sélection ne
          réapparaîtra que le jour où un second mode sera créé. */}
      {active && multiMode && (
        <>
          <div className="space-y-1.5">
            <Label>Modes autorisés</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {modes.map((m) => (
                <label
                  key={m.key}
                  className="flex cursor-pointer items-center gap-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    name="allowed_modes"
                    value={m.key}
                    checked={allowed.includes(m.key)}
                    onChange={() => toggleMode(m.key)}
                    className="accent-primary-600 size-4"
                  />
                  {m.label_fr}
                  {!m.enabled && (
                    <span className="text-muted text-[10px]">(désactivé)</span>
                  )}
                </label>
              ))}
            </div>
            {allowed.length === 0 && (
              <p className="text-danger-600 text-xs">
                Au moins un mode est requis.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor={`default-${rule.profile}`}>Mode par défaut</Label>
              <select
                id={`default-${rule.profile}`}
                name="default_mode"
                value={defaultMode}
                onChange={(e) => setDefaultMode(e.target.value)}
                className="border-border bg-surface h-9 w-full rounded-[10px] border px-2 text-sm"
              >
                {allowed.map((key) => (
                  <option key={key} value={key}>
                    {modes.find((m) => m.key === key)?.label_fr ?? key}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                name="user_can_choose_mode"
                checked={userChoose}
                onChange={(e) => setUserChoose(e.target.checked)}
                className="accent-primary-600 size-4"
              />
              L&apos;utilisateur choisit
            </label>
          </div>
        </>
      )}

      {/* Champs masqués (règle désactivée, ou mode unique) : la règle COMPLÈTE
          reste soumise — un update partiel effacerait les colonnes absentes
          (piège connu du projet). */}
      {(!active || !multiMode) && (
        <>
          {allowed.map((key) => (
            <input key={key} type="hidden" name="allowed_modes" value={key} />
          ))}
          <input type="hidden" name="default_mode" value={defaultMode} />
          {userChoose && (
            <input type="hidden" name="user_can_choose_mode" value="on" />
          )}
        </>
      )}

      {state.error && <p className="text-danger-600 text-sm">{state.error}</p>}
      <div className="flex justify-end">
        <ActionButton
          type="submit"
          size="sm"
          state={fb}
          disabled={allowed.length === 0}
          labels={{ idle: "Enregistrer", success: "Mis à jour ✓" }}
        />
      </div>
    </form>
  );
}
