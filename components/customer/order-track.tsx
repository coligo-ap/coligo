import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/lib/types";

/**
 * Suivi HORIZONTAL compact (façon maquette « suivi v2 ») : les 5 étapes sur une
 * seule ligne, reliées par une barre de progression qui se remplit (verte pour
 * les étapes franchies, violet pour l'étape en cours). Remplace l'ancien suivi
 * vertical qui forçait le scroll.
 *
 * Deux jeux d'étapes selon le mode :
 *  - retrait  : Envoyée → Acceptée → Prépa → Prête → Récup.
 *  - livraison : Envoyée → Acceptée → Prépa → En route → Livrée
 *
 * On ne touche PAS à la logique de statuts : on lit `status` (+ `pickedUp` pour
 * la livraison) et on en déduit l'étape courante, exactement comme le faisait
 * le suivi vertical.
 */

const PICKUP_STEPS = ["Envoyée", "Acceptée", "Prépa", "Prête", "Récup."];
const DELIVERY_STEPS = ["Envoyée", "Acceptée", "Prépa", "En route", "Livrée"];

/** Étape active (0-4) selon le statut. completed → tout franchi. */
function currentStep(
  isDelivery: boolean,
  status: OrderStatus,
  pickedUp: boolean
): { step: number; allDone: boolean } {
  if (status === "completed") return { step: 4, allDone: true };
  if (isDelivery) {
    if (pickedUp) return { step: 3, allDone: false }; // En route
    if (status === "ready") return { step: 2, allDone: false }; // prête, attend le livreur
    if (status === "preparing") return { step: 2, allDone: false };
    if (status === "accepted") return { step: 1, allDone: false };
    return { step: 0, allDone: false }; // pending
  }
  switch (status) {
    case "ready":
      return { step: 3, allDone: false };
    case "preparing":
      return { step: 2, allDone: false };
    case "accepted":
      return { step: 1, allDone: false };
    default:
      return { step: 0, allDone: false }; // pending
  }
}

export function OrderTrack({
  isDelivery,
  status,
  pickedUp = false,
}: {
  isDelivery: boolean;
  status: OrderStatus;
  pickedUp?: boolean;
}) {
  const labels = isDelivery ? DELIVERY_STEPS : PICKUP_STEPS;
  const { step, allDone } = currentStep(isDelivery, status, pickedUp);
  // Largeur de la barre verte : 0 / 25 / 50 / 75 / 100 % (cf. maquette).
  const progPct = allDone ? 100 : step * 25;

  return (
    <div className="relative mt-4">
      <div className="relative flex justify-between">
        {/* rail gris de fond */}
        <span className="bg-border absolute top-[11px] right-[18px] left-[18px] h-0.5" />
        {/* progression verte */}
        <span
          className="bg-success-600 absolute top-[11px] left-[18px] h-0.5 rounded-full transition-[width] duration-500"
          style={{ width: `${progPct}%` }}
        />
        {labels.map((label, i) => {
          const done = allDone || i < step;
          const now = !allDone && i === step;
          return (
            <div
              key={label}
              className="relative z-[2] flex flex-1 flex-col items-center gap-1.5"
            >
              <span
                className={cn(
                  "border-surface grid size-6 place-items-center rounded-full border-2 text-[10px] font-extrabold",
                  done
                    ? "bg-success-600 text-white"
                    : now
                      ? "bg-primary-600 ring-primary-100 text-white ring-4"
                      : "bg-surface-3 text-subtle"
                )}
              >
                {done ? (
                  <Check className="size-3" strokeWidth={3} />
                ) : now ? (
                  "●"
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={cn(
                  "max-w-[48px] text-center text-[8.5px] leading-tight font-bold",
                  done || now ? "text-foreground" : "text-subtle"
                )}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
