"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Loader2 } from "lucide-react";
import { setNotifyDriverOnVerify } from "@/app/admin/drivers/actions";

/**
 * Réglage plateforme — « Notifier automatiquement le livreur lors de
 * l'activation de son compte ». Activé par défaut. Il fixe la valeur par
 * défaut de la case présentée sur chaque fiche livreur au moment de la
 * décision, qui reste modifiable au cas par cas.
 */
export function NotifyOnVerifyToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(enabled);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    const next = !value;
    setValue(next);
    setError(null);
    start(async () => {
      const r = await setNotifyDriverOnVerify(next);
      if (r.error) {
        setValue(!next);
        setError(r.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="border-border bg-surface rounded-[12px] border p-4">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={toggle}
        disabled={pending}
        className="flex w-full items-center gap-3 text-left disabled:opacity-60"
      >
        <span className="bg-primary-50 text-primary-600 grid size-9 shrink-0 place-items-center rounded-[10px]">
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Bell className="size-4" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            Notifier automatiquement le livreur lors de l&apos;activation de son
            compte
          </span>
          <span className="text-muted block text-xs">
            Notification push + notification interne, envoyées dès la validation
            (ou le refus) du dossier.
          </span>
        </span>
        <span
          className="relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors"
          style={{ background: value ? "#16b364" : "#D6D9E2" }}
        >
          <span
            className="absolute top-[3px] size-[20px] rounded-full bg-white shadow-sm transition-all"
            style={{ insetInlineStart: value ? 23 : 3 }}
          />
        </span>
      </button>
      {error && <p className="text-danger-600 mt-2 text-xs">{error}</p>}
    </div>
  );
}
