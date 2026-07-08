"use client";

import { useState, useTransition } from "react";
import { Loader2, Send, ShieldAlert } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm";
import { setColigoPayP2p } from "@/app/admin/actions";
import { cn } from "@/lib/utils";

/**
 * Carte « Transferts Coligo Pay (Envoyer / Recevoir) » de /admin/controle :
 * interrupteur du flag platform_settings.p2p_enabled. Désactivé (défaut), TOUTES
 * les surfaces P2P sont masquées côté client (exigence Google Play — pas de
 * transfert d'argent entre utilisateurs sur un compte non-organisation).
 * L'activation demande une confirmation explicite (implications réglementaires).
 * Effet immédiat, sans redéploiement.
 */
export function ColigoPayP2pCard({ enabled }: { enabled: boolean }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(enabled);
  const [msg, setMsg] = useState<{ err?: string; ok?: string }>({});

  const toggle = async () => {
    const next = !on;
    setMsg({});
    if (next) {
      const ok = await confirm({
        title: "Activer les transferts Envoyer / Recevoir ?",
        message:
          "Les clients pourront s'envoyer du solde Coligo Pay entre eux (P2P). Google Play classe le transfert d'argent entre utilisateurs comme fonctionnalité financière régulée : ne l'activez que si votre compte / cadre réglementaire l'autorise (compte organisation), sinon l'app risque un retrait du Store.",
        confirmLabel: "Activer les transferts",
        danger: true,
      });
      if (!ok) return;
    }
    start(async () => {
      const r = await setColigoPayP2p(next);
      if (r.error) {
        setMsg({ err: r.error });
        return;
      }
      setOn(next);
      setMsg({
        ok: next
          ? "Transferts activés — les boutons Envoyer / Recevoir apparaissent côté client."
          : "Transferts désactivés — les surfaces Envoyer / Recevoir sont masquées côté client.",
      });
    });
  };

  return (
    <div className="border-border bg-surface rounded-[16px] border p-4">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-[12px]",
            on ? "bg-green-100 text-green-700" : "bg-surface-3 text-muted"
          )}
        >
          <Send className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-foreground flex items-center gap-2 text-sm font-semibold">
            Transferts Coligo Pay (Envoyer / Recevoir)
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-wide uppercase",
                on
                  ? "bg-green-100 text-green-800"
                  : "bg-amber-100 text-amber-800"
              )}
            >
              {on ? "Actif" : "Masqué"}
            </span>
          </p>
          <p className="text-muted mt-0.5 text-xs">
            Masqué = crédit fermé (aucun transfert d&apos;argent exposé), requis
            pour Google Play. S&apos;applique immédiatement, sans redéploiement.
          </p>
        </div>
        {/* Interrupteur */}
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Activer ou masquer les transferts Coligo Pay"
          onClick={toggle}
          disabled={pending}
          className={cn(
            "relative h-[30px] w-[52px] shrink-0 rounded-full transition-colors",
            on ? "bg-green-600" : "bg-surface-3 border-border border"
          )}
        >
          {pending ? (
            <Loader2 className="absolute top-[7px] left-[18px] size-4 animate-spin text-white" />
          ) : (
            <span
              className="absolute top-[3px] size-[24px] rounded-full bg-white shadow-sm transition-all"
              style={{ left: on ? 25 : 3 }}
            />
          )}
        </button>
      </div>

      {!on && (
        <p className="text-muted mt-3 flex items-start gap-1.5 text-xs">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          Gardez ce réglage masqué tant que l&apos;app n&apos;est pas sur un
          compte organisation autorisant le transfert d&apos;argent.
        </p>
      )}

      {msg.err && (
        <p className="border-danger-200 bg-danger-50 text-danger-800 mt-3 rounded-[10px] border px-3 py-2 text-sm">
          {msg.err}
        </p>
      )}
      {msg.ok && (
        <p className="mt-3 rounded-[10px] border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {msg.ok}
        </p>
      )}
    </div>
  );
}
