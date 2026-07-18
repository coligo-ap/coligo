"use client";

import { useState, useTransition } from "react";
import { FlaskConical, Globe, Loader2, ShieldAlert } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm";
import { setStripeLiveMode } from "@/app/admin/actions";
import { cn } from "@/lib/utils";

/**
 * Carte « Environnement Stripe » de /admin/controle : bascule TEST/LIVE des
 * paiements internationaux (€). Même modèle que ChargilyModeCard : le mode
 * vit en base (effet immédiat), les clés restent dans l'environnement — on
 * n'affiche que leur PRÉSENCE. Passage en LIVE = confirmation explicite.
 */
export function StripeModeCard({
  live,
  keys,
}: {
  live: boolean;
  keys: {
    test: boolean;
    live: boolean;
    webhook_test: boolean;
    webhook_live: boolean;
  };
}) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ err?: string; ok?: string }>({});

  const toggle = async () => {
    const next = !live;
    setMsg({});
    if (next) {
      const ok = await confirm({
        title: "Passer les paiements internationaux en mode LIVE ?",
        message:
          "Les clients paieront avec de l'ARGENT RÉEL en euros (Visa / Mastercard / Apple Pay). Vérifiez que le compte Stripe live est activé et que le webhook live est configuré.",
        confirmLabel: "Activer le mode live",
        danger: true,
      });
      if (!ok) return;
    }
    start(async () => {
      const r = await setStripeLiveMode(next);
      setMsg(
        r.error
          ? { err: r.error }
          : {
              ok: next
                ? "Mode LIVE actif — les paiements € encaissent de l'argent réel."
                : "Mode TEST actif — aucun argent réel n'est encaissé.",
            }
      );
    });
  };

  return (
    <div className="border-border bg-surface rounded-[16px] border p-4">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-[12px]",
            live ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
          )}
        >
          {live ? (
            <Globe className="size-5" />
          ) : (
            <FlaskConical className="size-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-foreground flex items-center gap-2 text-sm font-semibold">
            Environnement Stripe (€)
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-wide uppercase",
                live
                  ? "bg-green-100 text-green-800"
                  : "bg-amber-100 text-amber-800"
              )}
            >
              {live ? "Live — argent réel" : "Test"}
            </span>
          </p>
          <p className="text-muted mt-0.5 text-xs">
            S&apos;applique immédiatement aux paiements internationaux par carte
            (diaspora) — sans redéploiement.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={live}
          aria-label="Basculer entre test et live"
          onClick={toggle}
          disabled={pending}
          className={cn(
            "relative h-[30px] w-[52px] shrink-0 rounded-full transition-colors",
            live ? "bg-green-600" : "bg-surface-3 border-border border"
          )}
        >
          {pending ? (
            <Loader2 className="absolute top-[7px] left-[18px] size-4 animate-spin text-white" />
          ) : (
            <span
              className="absolute top-[3px] size-[24px] rounded-full bg-white shadow-sm transition-all"
              style={{ left: live ? 25 : 3 }}
            />
          )}
        </button>
      </div>

      {/* Présence des clés (jamais les valeurs). */}
      <div className="text-muted mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>
          Clé test :{" "}
          <b className={keys.test ? "text-green-700" : "text-danger-600"}>
            {keys.test ? "configurée" : "absente"}
          </b>
        </span>
        <span>
          Clé live :{" "}
          <b className={keys.live ? "text-green-700" : "text-danger-600"}>
            {keys.live ? "configurée" : "absente"}
          </b>
        </span>
        <span>
          Webhook test :{" "}
          <b
            className={keys.webhook_test ? "text-green-700" : "text-danger-600"}
          >
            {keys.webhook_test ? "configuré" : "absent"}
          </b>
        </span>
        <span>
          Webhook live :{" "}
          <b
            className={keys.webhook_live ? "text-green-700" : "text-danger-600"}
          >
            {keys.webhook_live ? "configuré" : "absent"}
          </b>
        </span>
      </div>
      {!keys.live && (
        <p className="text-muted mt-2 flex items-start gap-1.5 text-xs">
          <ShieldAlert className="text-danger-600 mt-0.5 size-3.5 shrink-0" />
          Ajoutez STRIPE_LIVE_SECRET_KEY dans les variables d&apos;environnement
          Vercel (production) puis redéployez pour pouvoir activer le live.
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
