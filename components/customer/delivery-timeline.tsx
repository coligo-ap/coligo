import { Check, Loader2, MapPin, Package, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/lib/types";

/**
 * Timeline visuelle pour les commandes LIVRAISON côté client.
 * Mappe les statuts existants vers 4 étapes lisibles :
 *  1. Préparée  (pending/accepted/preparing/ready)
 *  2. Récupérée par le livreur (delivery_picked_up_at non null)
 *  3. En route  (idem — distinction visuelle, pas de statut SQL séparé)
 *  4. Livrée    (completed)
 *
 * Cancelled : rendu spécifique en haut.
 *
 * Pour le retrait sur place, on n'affiche PAS la timeline (le suivi par
 * statut existant suffit). Le caller décide d'utiliser ce composant.
 */
export function DeliveryTimeline({
  status,
  pickedUpAt,
  deliveredAt,
}: {
  status: OrderStatus;
  pickedUpAt: string | null;
  deliveredAt: string | null;
}) {
  const cancelled = status === "cancelled";

  // Étape 1 : préparation
  const step1Done =
    status === "ready" ||
    pickedUpAt != null ||
    deliveredAt != null ||
    status === "completed";
  const step1Current =
    !step1Done &&
    (status === "pending" || status === "accepted" || status === "preparing");

  // Étape 2 : pickup par le livreur
  const step2Done = pickedUpAt != null || deliveredAt != null;
  const step2Current = step1Done && !step2Done && status === "ready";

  // Étape 3 : en route (entre pickup et delivered)
  const step3Done = deliveredAt != null;
  const step3Current = step2Done && !step3Done;

  // Étape 4 : livrée
  const step4Done = deliveredAt != null || status === "completed";

  if (cancelled) {
    return (
      <div className="border-danger-200 bg-danger-50 text-danger-700 rounded-[14px] border p-4 text-sm">
        Commande annulée.
      </div>
    );
  }

  const steps = [
    {
      label: "Préparée",
      sub: "Le commerçant prépare ta commande",
      icon: Package,
      done: step1Done,
      current: step1Current,
    },
    {
      label: "Récupérée",
      sub: "Le livreur a pris la commande",
      icon: Truck,
      done: step2Done,
      current: step2Current,
    },
    {
      label: "En route",
      sub: "Le livreur arrive bientôt",
      icon: MapPin,
      done: step3Done,
      current: step3Current,
    },
    {
      label: "Livrée",
      sub: deliveredAt
        ? new Date(deliveredAt).toLocaleString("fr-FR")
        : "À ta porte",
      icon: Check,
      done: step4Done,
      current: false,
    },
  ];

  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const Icon = s.icon;
        return (
          <li key={s.label} className="flex items-start gap-3">
            <span
              className={cn(
                "relative flex size-9 shrink-0 items-center justify-center rounded-full",
                s.done
                  ? "bg-success-600 text-white"
                  : s.current
                    ? "bg-primary-100 text-primary-700"
                    : "bg-surface-3 text-muted"
              )}
            >
              {s.current ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Icon className="size-4" />
              )}
              {i < steps.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-9 left-1/2 h-3 w-0.5 -translate-x-1/2",
                    s.done ? "bg-success-600" : "bg-surface-3"
                  )}
                />
              )}
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p
                className={cn(
                  "text-sm font-semibold",
                  s.done
                    ? "text-foreground"
                    : s.current
                      ? "text-primary-700"
                      : "text-muted"
                )}
              >
                {s.label}
              </p>
              <p className="text-muted text-xs">{s.sub}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
