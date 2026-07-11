"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Ban, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm, usePrompt } from "@/components/ui/confirm";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
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
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [pending, start] = useTransition();
  const [fb, setFb] = useActionNote();
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        size="sm"
        type="button"
        variant={blocked ? "secondary" : "destructive"}
        onClick={async () => {
          const note = blocked
            ? undefined
            : ((await prompt({
                title: "Raison du blocage",
                placeholder: "Dangereux / suspect / violation du contrat…",
              })) ?? undefined);
          if (
            !(await confirm({
              title: blocked
                ? "Débloquer ce livreur ?"
                : "Bloquer ce livreur ?",
              message: blocked
                ? "Il retrouvera l'accès complet."
                : "Il perdra TOUT accès (sanction dure).",
              confirmLabel: blocked ? "Débloquer" : "Bloquer",
              danger: !blocked,
            }))
          )
            return;
          start(async () => {
            const r = await toggleDriverBlocked(driverId, !blocked, note);
            // Succès : le libellé bascule (Bloquer ↔ Débloquer) via refresh (visuel).
            if (r.error) setFb({ ok: false, text: r.error });
            else router.refresh();
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
      <ActionNote note={fb} />
    </div>
  );
}
