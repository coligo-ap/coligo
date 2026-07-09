"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Bell, Loader2, ShieldX, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  rejectDriverDossier,
  setDriverVerified,
} from "@/app/admin/drivers/actions";

export type VerifyStage = "kyc" | "pending" | "verified";

/**
 * Panneau de décision sur le dossier d'un livreur (valider / refuser).
 *
 * L'interrupteur « Notifier automatiquement le livreur » est ACTIVÉ PAR DÉFAUT
 * (il reflète le réglage plateforme `notify_driver_on_verify`). Quand il est
 * actif, la décision déclenche immédiatement une notification push ET une
 * notification interne — le livreur est informé sans attendre.
 *
 * Le rôle « super admin » n'apparaît jamais côté livreur : toutes les
 * communications sont signées « l'équipe Coligo ».
 */
export function DriverVerifyPanel({
  driverId,
  verified,
  stage,
  notifyDefault,
}: {
  driverId: string;
  verified: boolean;
  stage: VerifyStage;
  notifyDefault: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notify, setNotify] = useState(notifyDefault);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const act = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.error) {
        setError(r.error);
        return;
      }
      setError(null);
      setRejecting(false);
      setReason("");
      router.refresh();
    });

  return (
    <div className="border-border bg-surface w-full rounded-[14px] border p-3 lg:w-[360px]">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={notify}
          onChange={(e) => setNotify(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-violet-600"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Bell className="size-3.5" />
            Notifier automatiquement le livreur
          </span>
          <span className="text-muted block text-xs">
            Push + notification interne dès l&apos;activation (ou le refus) de
            son compte.
          </span>
        </span>
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          type="button"
          variant={verified ? "secondary" : "default"}
          disabled={pending}
          onClick={() =>
            act(() => setDriverVerified(driverId, !verified, notify))
          }
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : verified ? (
            <ShieldX className="size-3.5" />
          ) : (
            <BadgeCheck className="size-3.5" />
          )}
          {verified ? "Retirer la vérification" : "Valider le compte"}
        </Button>

        {!verified && (
          <Button
            size="sm"
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => setRejecting((v) => !v)}
          >
            <XCircle className="size-3.5" />
            Refuser le dossier
          </Button>
        )}
      </div>

      {rejecting && (
        <div className="mt-3 space-y-2">
          <label
            htmlFor="reject-reason"
            className="text-muted block text-xs font-medium"
          >
            Motif communiqué au livreur (il le verra en haut de son dossier)
          </label>
          <textarea
            id="reject-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex : la photo de la carte grise est illisible."
            className="border-border bg-surface-2 w-full rounded-[10px] border p-2 text-sm"
          />
          <Button
            size="sm"
            type="button"
            variant="destructive"
            disabled={pending || reason.trim().length < 5}
            onClick={() =>
              act(() => rejectDriverDossier(driverId, reason, notify))
            }
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Confirmer le refus
          </Button>
        </div>
      )}

      {error && <p className="text-danger-600 mt-2 text-xs">{error}</p>}

      <p className="text-subtle mt-3 text-xs">
        {stage === "kyc"
          ? "Dossier non transmis : le livreur remplit encore ses informations."
          : stage === "pending"
            ? "Dossier transmis. Le livreur n'a accès à aucune fonctionnalité tant qu'il n'est pas validé."
            : "Compte activé : le livreur peut se mettre en ligne et recevoir des courses."}
      </p>
    </div>
  );
}
