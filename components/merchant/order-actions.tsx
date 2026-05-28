"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, X, QrCode } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  nextOrderAction,
  ORDER_STATUS_META,
  type OrderStatus,
} from "@/lib/types";
import { enqueueOrExecute } from "@/lib/offline/queue";

/**
 * Actions contextuelles du détail commande :
 * - pending   → Accepter / Refuser
 * - accepted  → Mettre en préparation
 * - preparing → Marquer comme prête
 * - ready     → RETRAIT : lien vers la validation de retrait (code 6 chiffres
 *               / QR). LIVRAISON : aucune validation commerçant — le livreur
 *               récupère et c'est lui qui confirme la remise au client.
 * - completed / cancelled → terminal (rien)
 */
export function OrderActions({
  orderId,
  status,
  fulfillmentType = "pickup",
}: {
  orderId: string;
  status: OrderStatus;
  /** "delivery" = pas de validation code côté commerçant (le livreur gère). */
  fulfillmentType?: "pickup" | "delivery";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(to: OrderStatus) {
    setError(null);
    startTransition(async () => {
      try {
        const outcome = await enqueueOrExecute({
          type: "update_status",
          orderId,
          to,
        });
        if (outcome.mode === "queued") {
          // Offline : l'action est enfilée, le serveur l'appliquera à la
          // reconnexion. UI optimiste : on remonte un toast informatif.
          toast.info(
            `Hors ligne — « ${ORDER_STATUS_META[to].label} » sera synchronisé.`
          );
          return;
        }
        const res = outcome.result;
        if (res.error) {
          setError(res.error);
          toast.error(res.error);
          return;
        }
        toast.success(`Commande : ${ORDER_STATUS_META[to].label}`);
        router.refresh();
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erreur inattendue.";
        setError(message);
        toast.error(message);
      }
    });
  }

  if (status === "completed") {
    return (
      <p className="text-success-700 bg-success-50 rounded-[12px] px-4 py-3 text-sm font-medium">
        Commande récupérée — terminée.
      </p>
    );
  }
  if (status === "cancelled") {
    return (
      <p className="text-muted bg-surface-3 rounded-[12px] px-4 py-3 text-sm font-medium">
        Commande annulée.
      </p>
    );
  }

  const next = nextOrderAction(status);
  const isDelivery = fulfillmentType === "delivery";

  // LIVRAISON, commande prête : rien à valider côté commerçant. Le livreur
  // récupère la commande (simple bouton de son côté) puis confirme la remise
  // au client. Le commerçant attend juste le passage du livreur.
  if (status === "ready" && isDelivery) {
    return (
      <p className="text-primary-800 bg-primary-50 border-primary-200 rounded-[12px] border px-4 py-3 text-sm font-medium">
        Commande prête — en attente du livreur. La remise sera confirmée par le
        livreur (pas de code à valider ici).
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {status === "ready" ? (
        <Link
          href="/orders/validate"
          className={cn(buttonVariants({ size: "lg" }), "w-full")}
        >
          <QrCode className="size-4" />
          Valider le retrait
        </Link>
      ) : (
        next && (
          <Button
            size="lg"
            className="w-full"
            disabled={pending}
            onClick={() => run(next.to)}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            {next.label}
          </Button>
        )
      )}

      {status === "pending" && (
        <Button
          variant="outline"
          size="lg"
          className="text-danger-700 hover:bg-danger-50 w-full"
          disabled={pending}
          onClick={() => run("cancelled")}
        >
          <X className="size-4" />
          Refuser
        </Button>
      )}

      {error && <p className="text-danger-600 text-sm">{error}</p>}
    </div>
  );
}
