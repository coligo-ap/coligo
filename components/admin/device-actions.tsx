"use client";

import { useTransition } from "react";
import { Ban, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { useConfirm, usePrompt } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import {
  blockIp,
  disconnectIp,
  disconnectUser,
  unblockIp,
} from "@/app/admin/(confiance)/devices/actions";

/**
 * Actions super-admin sur une IP (carte « IP partagées » + lignes du tableau) :
 *   • Déconnecter — supprime les sessions de TOUS les comptes vus sur l'IP.
 *   • Bloquer / Débloquer — bannit l'IP (message optionnel affiché à
 *     l'utilisateur : on peut bloquer AVEC ou SANS message).
 */
export function IpActions({ ip, blocked }: { ip: string; blocked: boolean }) {
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [pending, start] = useTransition();

  const onDisconnect = () =>
    start(async () => {
      if (
        !(await confirm({
          title: `Déconnecter les sessions de ${ip} ?`,
          message: "Tous les comptes vus sur cette IP seront déconnectés.",
          confirmLabel: "Déconnecter",
          danger: true,
        }))
      )
        return;
      const r = await disconnectIp(ip);
      if (r.error) toast.error(r.error);
      else toast.success(`${r.count ?? 0} session(s) déconnectée(s)`);
    });

  const onBlock = () =>
    start(async () => {
      const message = await prompt({
        title: `Bloquer l'IP ${ip} ?`,
        message:
          "Message affiché à l'utilisateur bloqué (optionnel — laisser vide pour bloquer sans message).",
        placeholder: "Ex. Compte suspendu pour fraude",
        multiline: true,
      });
      if (message === null) return; // annulé
      const r = await blockIp(ip, message);
      if (r.error) toast.error(r.error);
      else toast.success("IP bloquée");
    });

  const onUnblock = () =>
    start(async () => {
      if (
        !(await confirm({
          title: `Débloquer l'IP ${ip} ?`,
          confirmLabel: "Débloquer",
        }))
      )
        return;
      const r = await unblockIp(ip);
      if (r.error) toast.error(r.error);
      else toast.success("IP débloquée");
    });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={onDisconnect}
        className="border-border hover:bg-surface-2 text-foreground inline-flex items-center gap-1 rounded-[8px] border px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <LogOut className="size-3" />
        )}
        Déconnecter
      </button>
      {blocked ? (
        <button
          type="button"
          disabled={pending}
          onClick={onUnblock}
          className="border-success-200 text-success-700 hover:bg-success-50 inline-flex items-center gap-1 rounded-[8px] border px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
        >
          <ShieldCheck className="size-3" />
          Débloquer l&apos;IP
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={onBlock}
          className="border-danger-200 text-danger-700 hover:bg-danger-50 inline-flex items-center gap-1 rounded-[8px] border px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
        >
          <Ban className="size-3" />
          Bloquer l&apos;IP
        </button>
      )}
    </div>
  );
}

/** Déconnexion d'un compte précis (toutes ses sessions). */
export function UserDisconnect({ userId }: { userId: string }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const onClick = () =>
    start(async () => {
      if (
        !(await confirm({
          title: "Déconnecter ce compte ?",
          message: "Toutes ses sessions seront fermées.",
          confirmLabel: "Déconnecter",
          danger: true,
        }))
      )
        return;
      const r = await disconnectUser(userId);
      if (r.error) toast.error(r.error);
      else toast.success(`${r.count ?? 0} session(s) déconnectée(s)`);
    });
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      title="Déconnecter ce compte"
      className="border-border hover:bg-surface-2 text-muted hover:text-foreground inline-flex items-center gap-1 rounded-[8px] border px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <LogOut className="size-3" />
      )}
      Déconnecter
    </button>
  );
}
