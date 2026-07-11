"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import { forceDriverSignout } from "@/app/admin/actions";

/**
 * Déconnexion forcée d'un livreur (indépendante du gel/blocage) : révoque sa
 * session active. Le compte reste utilisable — il devra juste se reconnecter.
 */
export function DriverForceSignoutButton({ driverId }: { driverId: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [note, setNote] = useActionNote();
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        size="sm"
        type="button"
        variant="outline"
        onClick={async () => {
          if (
            !(await confirm({
              title: "Déconnecter de force ce livreur ?",
              message: "Toutes ses sessions actives seront révoquées.",
              confirmLabel: "Déconnecter",
              danger: true,
            }))
          )
            return;
          start(async () => {
            const r = await forceDriverSignout(driverId);
            // Pas de changement visuel (le compte reste) → note du résultat.
            if (r.error) setNote({ ok: false, text: r.error });
            else
              setNote({
                ok: true,
                text: `Déconnecté (${r.killed ?? 0} session·s)`,
              });
            router.refresh();
          });
        }}
        disabled={pending}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <LogOut className="size-3.5" />
        )}
        Déconnecter
      </Button>
      <ActionNote note={note} />
    </div>
  );
}
