"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Power } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { setOrdersPaused } from "@/app/(merchant)/actions";

/**
 * Bouton header « Ouvert / Fermé » : coupe ou rétablit instantanément la
 * réception de commandes (indépendant des horaires). Optimiste + confirmation
 * à la fermeture pour éviter les coupures accidentelles.
 */
export function ShopStatusToggle({
  initialPaused,
}: {
  initialPaused: boolean;
}) {
  const router = useRouter();
  const [paused, setPaused] = useState(initialPaused);
  const [pending, start] = useTransition();

  const toggle = () => {
    const next = !paused;
    if (
      next &&
      !confirm(
        "Fermer maintenant ? Tu ne recevras plus de nouvelles commandes jusqu'à réouverture."
      )
    ) {
      return;
    }
    setPaused(next); // optimiste
    start(async () => {
      const r = await setOrdersPaused(next);
      if (!r.ok) {
        setPaused(!next);
        toast.error(r.error ?? "Impossible de changer le statut.");
        return;
      }
      toast.success(
        next ? "Boutique fermée — commandes en pause" : "Boutique ouverte ✓"
      );
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      title={
        paused ? "Fermé — cliquer pour rouvrir" : "Ouvert — cliquer pour fermer"
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60",
        paused
          ? "border-danger-300 bg-danger-50 text-danger-700"
          : "border-success-300 bg-success-50 text-success-700"
      )}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <span
          className={cn(
            "size-2 rounded-full",
            paused ? "bg-danger-500" : "bg-success-500 animate-pulse"
          )}
        />
      )}
      {paused ? "Fermé" : "Ouvert"}
      <Power className="size-3.5" />
    </button>
  );
}
