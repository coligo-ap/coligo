"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/ui/action-button";
import { useFormActionFeedback } from "@/lib/hooks/use-action-button";
import { updateDispatchRadii, type AdminFormState } from "@/app/admin/actions";

const initialState: AdminFormState = {};

export function DispatchRadiiForm({
  express,
  drive,
}: {
  express: number;
  drive: number;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    updateDispatchRadii,
    initialState
  );
  const fb = useFormActionFeedback({
    pending,
    ok: state.ok,
    error: state.error,
  });

  useEffect(() => {
    // Feedback porté par le bouton + message inline ci-dessous (pas de toast).
    if (state.ok) router.refresh();
  }, [state, router]);

  return (
    <form
      action={formAction}
      className="border-border bg-surface space-y-4 rounded-[16px] border p-5"
    >
      <p className="text-muted text-xs">
        Distance maximale entre l&apos;acteur (livreur / chauffeur) et le point
        de retrait. Un livreur/chauffeur ne reçoit jamais une commande/course
        au-delà de ce rayon (sauf zone perso plus large). S&apos;applique
        immédiatement.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="express_dispatch_radius_km">
            Express — livreur (km)
          </Label>
          <Input
            id="express_dispatch_radius_km"
            name="express_dispatch_radius_km"
            type="number"
            step="0.5"
            min="0.5"
            max="50"
            defaultValue={express}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="drive_dispatch_radius_km">
            Drive — chauffeur (km)
          </Label>
          <Input
            id="drive_dispatch_radius_km"
            name="drive_dispatch_radius_km"
            type="number"
            step="0.5"
            min="0.5"
            max="60"
            defaultValue={drive}
          />
        </div>
      </div>
      {state.error && <p className="text-danger-600 text-sm">{state.error}</p>}
      <div className="flex justify-end">
        <ActionButton
          type="submit"
          size="sm"
          state={fb}
          labels={{ idle: "Enregistrer", success: "Rayons mis à jour ✓" }}
        />
      </div>
    </form>
  );
}
