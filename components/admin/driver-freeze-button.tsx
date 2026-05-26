"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { toggleDriverFrozen } from "@/app/admin/actions";

export function DriverFreezeButton({
  driverId,
  frozen,
}: {
  driverId: string;
  frozen: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      type="button"
      variant={frozen ? "default" : "secondary"}
      onClick={() => {
        const note = frozen
          ? undefined
          : (prompt("Raison du gel (optionnel)") ?? undefined);
        if (
          !confirm(
            frozen
              ? "Dégeler ce livreur ? Il retrouvera l'accès."
              : "Geler ce livreur ? Il perdra l'accès immédiatement."
          )
        )
          return;
        start(async () => {
          const r = await toggleDriverFrozen(driverId, !frozen, note);
          if (r.error) toast.error(r.error);
          else toast.success(frozen ? "Livreur dégelé" : "Livreur gelé");
          router.refresh();
        });
      }}
      disabled={pending}
    >
      {pending && <Loader2 className="size-3.5 animate-spin" />}
      {frozen ? "Dégeler" : "Geler"}
    </Button>
  );
}
