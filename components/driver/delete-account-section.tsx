"use client";

import { useTransition } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/ui/action-button";
import { useActionButton } from "@/lib/hooks/use-action-button";
import { deleteDriverAccount } from "@/app/(driver)/actions";
import { toast } from "@/components/ui/toast";

export function DeleteAccountSection() {
  const { state, run } = useActionButton();
  const [pending, start] = useTransition();

  const onDelete = () => {
    if (
      !confirm(
        "Supprimer définitivement ton compte livreur ? Tu perdras l'accès à toutes tes boutiques et ton historique."
      )
    )
      return;
    start(async () => {
      await run(async () => {
        const r = await deleteDriverAccount();
        if (r?.error) {
          toast.error(r.error);
          return { ok: false };
        }
        return { ok: true };
      });
    });
  };

  return (
    <section className="border-danger-200 bg-danger-50 space-y-3 rounded-[14px] border p-4">
      <h2 className="text-danger-700 flex items-center gap-2 text-base font-semibold">
        <AlertTriangle className="size-4" />
        Zone dangereuse
      </h2>
      <p className="text-danger-700 text-sm">
        Supprimer ton compte révoque immédiatement l&apos;accès à toutes les
        boutiques où tu étais livreur. L&apos;historique de livraisons est
        anonymisé (ton lien est retiré). Cette action est irréversible.
      </p>
      <ActionButton
        type="button"
        variant="destructive"
        state={pending ? "pending" : state}
        labels={{
          idle: "Supprimer mon compte",
          pending: "Suppression…",
          success: "Compte supprimé",
          error: "Échec — réessaie",
        }}
        idleIcon={<Trash2 className="size-4" />}
        onClick={onDelete}
      />
    </section>
  );
}
