"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Ban, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { toggleDriverBlocked } from "@/app/admin/actions";

/**
 * Blocage DUR d'un livreur (différent du gel) : coupe tout accès à ses pages.
 * Réservé aux cas graves (dangereux / suspect / violation du contrat).
 */
export function DriverBlockButton({
  driverId,
  blocked,
}: {
  driverId: string;
  blocked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      type="button"
      variant={blocked ? "secondary" : "destructive"}
      onClick={() => {
        const note = blocked
          ? undefined
          : (prompt("Raison du blocage (dangereux / suspect / violation…)") ??
            undefined);
        if (
          !confirm(
            blocked
              ? "Débloquer ce livreur ? Il retrouvera l'accès complet."
              : "Bloquer ce livreur ? Il perdra TOUT accès (sanction dure)."
          )
        )
          return;
        start(async () => {
          const r = await toggleDriverBlocked(driverId, !blocked, note);
          if (r.error) toast.error(r.error);
          else toast.success(blocked ? "Livreur débloqué" : "Livreur bloqué");
          router.refresh();
        });
      }}
      disabled={pending}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : blocked ? (
        <ShieldCheck className="size-3.5" />
      ) : (
        <Ban className="size-3.5" />
      )}
      {blocked ? "Débloquer" : "Bloquer"}
    </Button>
  );
}
