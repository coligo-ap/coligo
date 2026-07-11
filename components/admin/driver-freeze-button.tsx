"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm, usePrompt } from "@/components/ui/confirm";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { toggleDriverFrozen } from "@/app/admin/actions";

export function DriverFreezeButton({
  driverId,
  frozen,
}: {
  driverId: string;
  frozen: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [pending, start] = useTransition();
  const [fb, setFb] = useActionNote();
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        size="sm"
        type="button"
        variant={frozen ? "default" : "secondary"}
        onClick={async () => {
          const note = frozen
            ? undefined
            : ((await prompt({
                title: "Raison du gel (optionnel)",
                placeholder: "Ex. impayés récurrents",
              })) ?? undefined);
          if (
            !(await confirm({
              title: frozen ? "Dégeler ce livreur ?" : "Geler ce livreur ?",
              message: frozen
                ? "Il retrouvera l'accès."
                : "Il perdra l'accès immédiatement.",
              confirmLabel: frozen ? "Dégeler" : "Geler",
              danger: !frozen,
            }))
          )
            return;
          start(async () => {
            const r = await toggleDriverFrozen(driverId, !frozen, note);
            // Succès : le libellé bascule (Geler ↔ Dégeler) via refresh (visuel).
            if (r.error) setFb({ ok: false, text: r.error });
            else router.refresh();
          });
        }}
        disabled={pending}
      >
        {pending && <Loader2 className="size-3.5 animate-spin" />}
        {frozen ? "Dégeler" : "Geler"}
      </Button>
      <ActionNote note={fb} />
    </div>
  );
}
