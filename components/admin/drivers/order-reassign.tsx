"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Users, UserCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { reassignDelivery } from "@/app/admin/drivers/actions";

export type CandidateDriver = { id: string; full_name: string };

/**
 * Retrait / réattribution instantanée d'une commande de livraison attribuée à
 * ce livreur : remise au réseau, attribution à un livreur précis, ou annulation.
 */
export function OrderReassign({
  orderId,
  driverId,
  candidates,
}: {
  orderId: string;
  driverId: string;
  candidates: CandidateDriver[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [pending, start] = useTransition();

  const run = (
    mode: "pool" | "driver" | "cancel",
    targetDriverId?: string,
    reason?: string
  ) =>
    start(async () => {
      const r = await reassignDelivery({
        orderId,
        driverId,
        mode,
        targetDriverId,
        reason,
      });
      if (r.error) toast.error(r.error);
      else {
        toast.success(
          mode === "cancel"
            ? "Commande annulée"
            : mode === "pool"
              ? "Commande remise au réseau"
              : "Commande réattribuée"
        );
        setOpen(false);
        router.refresh();
      }
    });

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
      >
        <RefreshCw className="size-3.5" />
        Réattribuer
      </Button>
    );
  }

  return (
    <div className="border-border bg-surface-2 mt-2 space-y-2 rounded-[12px] border p-3">
      <p className="text-muted text-xs font-semibold uppercase">
        Retirer cette commande au livreur
      </p>
      <p className="text-muted text-xs">
        Remet la course en livraison comme une nouvelle commande — même si le
        livreur a déclaré l&apos;avoir récupérée par erreur.
      </p>

      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="w-full justify-start"
        disabled={pending}
        onClick={() => run("pool")}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Users className="size-3.5" />
        )}
        Remettre au réseau (priorité réseau)
      </Button>

      <div className="flex gap-2">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="border-border bg-surface h-9 min-w-0 flex-1 rounded-[10px] border px-2 text-sm"
        >
          <option value="">Attribuer à un livreur…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          disabled={pending || !target}
          onClick={() => run("driver", target)}
        >
          <UserCheck className="size-3.5" />
          OK
        </Button>
      </div>

      <Button
        type="button"
        size="sm"
        variant="destructive"
        className="w-full justify-start"
        disabled={pending}
        onClick={() => {
          const reason =
            prompt("Raison de l'annulation ?") ?? "Annulation plateforme";
          run("cancel", undefined, reason);
        }}
      >
        <XCircle className="size-3.5" />
        Annuler la commande
      </Button>

      <button
        type="button"
        className="text-muted w-full text-center text-xs"
        onClick={() => setOpen(false)}
      >
        Fermer
      </button>
    </div>
  );
}
