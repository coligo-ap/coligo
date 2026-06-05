"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { cancelMyOrder } from "@/app/(customer)/commandes/actions";

type Props = {
  orderId: string;
  paymentMethod: "cash" | "online";
  paymentStatus: string | null;
};

/**
 * Bouton « Annuler ma commande » — visible UNIQUEMENT tant que la commande est
 * en attente (status='pending', géré par le parent). Pour une commande payée en
 * ligne, on n'autorise pas l'auto-annulation (remboursement via support) : on
 * affiche une note à la place. La vérification réelle (propriété, statut,
 * paiement) est refaite côté serveur par la RPC — ce composant est juste l'UI.
 */
export function CancelOrderButton({
  orderId,
  paymentMethod,
  paymentStatus,
}: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const onlinePaid = paymentMethod === "online" && paymentStatus === "paid";

  if (onlinePaid) {
    return (
      <p className="text-muted mt-2.5 flex items-start gap-1.5 text-[11.5px]">
        <AlertTriangle className="text-warning-600 mt-0.5 size-3.5 shrink-0" />
        Commande déjà payée en ligne — contacte le support pour l&apos;annuler
        et être remboursé.
      </p>
    );
  }

  function doCancel() {
    startTransition(async () => {
      const res = await cancelMyOrder(orderId);
      if (!res.ok) {
        toast.error(res.error);
        setConfirming(false);
        return;
      }
      toast.success("Commande annulée.");
      setConfirming(false);
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="border-danger-200 text-danger-700 hover:bg-danger-50 mt-2.5 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[12px] border text-[13px] font-bold"
      >
        <X className="size-4" />
        Annuler ma commande
      </button>
    );
  }

  return (
    <div className="border-danger-200 bg-danger-50 mt-2.5 rounded-[12px] border p-3">
      <p className="text-danger-800 text-[12.5px] font-semibold">
        Annuler cette commande ? Le commerçant en sera informé. Action
        irréversible.
      </p>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="border-border text-foreground hover:bg-surface-2 inline-flex h-10 flex-1 items-center justify-center rounded-[10px] border bg-white text-[13px] font-bold disabled:opacity-50"
        >
          Retour
        </button>
        <button
          type="button"
          onClick={doCancel}
          disabled={pending}
          className="bg-danger-600 hover:bg-danger-700 inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-bold text-white disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Oui, annuler"
          )}
        </button>
      </div>
    </div>
  );
}
