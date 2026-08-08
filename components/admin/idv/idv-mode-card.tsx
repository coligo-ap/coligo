"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import {
  updateIdvMode,
  type AdminFormState,
} from "@/app/admin/(confiance)/identite/actions";
import {
  IDV_CHECK_KEYS,
  IDV_CHECK_LABELS_FR,
  type IdvModeFull,
} from "@/lib/idv/types";
import {
  IDV_POLICY_FIELDS,
  type IdvPolicyField,
} from "@/lib/idv/settings-validation";

const initialState: AdminFormState = {};

const POLICY_LABELS: Record<IdvPolicyField, string> = {
  liveness_fail: "Liveness insuffisant",
  doc_low_confidence: "Document peu lisible",
  expired_document: "Document expiré",
  check_failed: "Contrôle en échec",
};

const toPct = (x: number) => Math.round(x * 1000) / 10;

/**
 * Configuration d'UN mode de vérification : activation, seuils de décision
 * (saisis en %), réaction aux échecs, contrôles exécutés. La barre de zones
 * visualise en direct refus / revue humaine / approbation automatique.
 */
export function IdvModeCard({ mode }: { mode: IdvModeFull }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    updateIdvMode,
    initialState
  );
  const fb = useFormActionFeedback({
    pending,
    ok: state.ok,
    error: state.error,
  });

  const [approvePct, setApprovePct] = useState(
    String(toPct(mode.face_match_approve))
  );
  const [rejectPct, setRejectPct] = useState(
    String(toPct(mode.face_match_reject))
  );

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  const a = Number(approvePct);
  const r = Number(rejectPct);
  const zonesValid =
    Number.isFinite(a) && Number.isFinite(r) && r >= 0 && a <= 100 && r < a;

  return (
    <form
      action={formAction}
      className="border-border bg-surface space-y-3 rounded-lg border p-4"
    >
      <input type="hidden" name="key" value={mode.key} />

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{mode.label_fr}</p>
          {mode.description_fr && (
            <p className="text-muted mt-0.5 text-xs leading-relaxed">
              {mode.description_fr}
            </p>
          )}
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={mode.enabled}
            className="accent-primary-600 size-4"
          />
          Actif
        </label>
      </div>

      {/* Seuils de décision (comparaison du visage), en %. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`approve-${mode.key}`}>Approbation auto ≥ (%)</Label>
          <Input
            id={`approve-${mode.key}`}
            name="face_match_approve"
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={approvePct}
            onChange={(e) => setApprovePct(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`reject-${mode.key}`}>Refus auto &lt; (%)</Label>
          <Input
            id={`reject-${mode.key}`}
            name="face_match_reject"
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={rejectPct}
            onChange={(e) => setRejectPct(e.target.value)}
            required
          />
        </div>
      </div>

      {/* Zones résultantes : refus / revue humaine / approbation. */}
      {zonesValid ? (
        <div>
          <div className="flex h-2 overflow-hidden rounded-full">
            <div className="bg-danger-500/80" style={{ width: `${r}%` }} />
            <div className="bg-warning-500/80" style={{ width: `${a - r}%` }} />
            <div
              className="bg-success-500/80"
              style={{ width: `${100 - a}%` }}
            />
          </div>
          <div className="text-muted text-micro mt-1 flex justify-between">
            <span>Refus &lt; {r} %</span>
            <span>Revue humaine</span>
            <span>Approbation ≥ {a} %</span>
          </div>
        </div>
      ) : (
        <p className="text-danger-600 text-xs">
          Le seuil de refus doit rester inférieur au seuil d&apos;approbation.
        </p>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`liveness-${mode.key}`}>Liveness min (%)</Label>
          <Input
            id={`liveness-${mode.key}`}
            name="liveness_min"
            type="number"
            min={0}
            max={100}
            step={0.5}
            defaultValue={toPct(mode.liveness_min)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`docmin-${mode.key}`}>Lisibilité min (%)</Label>
          <Input
            id={`docmin-${mode.key}`}
            name="doc_confidence_min"
            type="number"
            min={0}
            max={100}
            step={0.5}
            defaultValue={toPct(mode.doc_confidence_min)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`attempts-${mode.key}`}>Tentatives max</Label>
          <Input
            id={`attempts-${mode.key}`}
            name="max_attempts"
            type="number"
            min={1}
            max={10}
            step={1}
            defaultValue={mode.max_attempts}
            required
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Réaction aux échecs</Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {IDV_POLICY_FIELDS.map((field) => (
            <label
              key={field}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="text-muted">{POLICY_LABELS[field]}</span>
              <select
                name={`policy_${field}`}
                defaultValue={mode.policy?.[field] ?? "review"}
                className="border-border bg-surface rounded-control h-8 border px-2 text-xs"
              >
                <option value="review">Revue humaine</option>
                <option value="reject">Refus automatique</option>
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Contrôles exécutés</Label>
        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {IDV_CHECK_KEYS.map((check) =>
            check === "face_match" ? (
              <label
                key={check}
                className="text-muted flex items-center gap-1.5 text-sm"
              >
                {/* Toujours actif : une case désactivée ne se soumet pas → hidden. */}
                <input type="hidden" name="check_face_match" value="on" />
                <input type="checkbox" checked disabled className="size-4" />
                {IDV_CHECK_LABELS_FR[check]}
                <span className="text-micro">(toujours actif)</span>
              </label>
            ) : (
              <label
                key={check}
                className="flex cursor-pointer items-center gap-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  name={`check_${check}`}
                  defaultChecked={mode.checks?.[check] === true}
                  className="accent-primary-600 size-4"
                />
                {IDV_CHECK_LABELS_FR[check]}
              </label>
            )
          )}
        </div>
      </div>

      {state.error && <p className="text-danger-600 text-sm">{state.error}</p>}
      <div className="flex justify-end">
        <ActionButton
          type="submit"
          size="sm"
          state={fb}
          disabled={!zonesValid}
          labels={{ idle: "Enregistrer", success: "Mis à jour ✓" }}
        />
      </div>
    </form>
  );
}
