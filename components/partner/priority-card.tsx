"use client";

import { useEffect, useState } from "react";
import { Crown, Zap, BadgeCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// =============================================================================
// Carte « Abonnement Prioritaire » — commune livreur + chauffeur (ch.7).
// Paiement depuis le portefeuille opérateur (instantané). 2 avantages livrés :
// priorité dispatch + badge (« zones à forte demande » non annoncé tant que non
// livré). La priorité accélère mais ne bloque jamais.
// =============================================================================

type State = {
  partner: boolean;
  is_priority?: boolean;
  status?: string;
  period_end?: string | null;
  price_da?: number;
  eligible_first_month?: boolean;
  monthly_da?: number;
};

export function PriorityCard() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const sb = createClient();
    const { data } = await sb.rpc("my_priority_state");
    setState((data as State) ?? { partner: false });
  }
  useEffect(() => {
    load();
  }, []);

  async function subscribe() {
    setBusy(true);
    setMsg(null);
    const sb = createClient();
    const { data, error } = await sb.rpc("priority_subscribe", {
      p_payment_method: "wallet",
    });
    setBusy(false);
    const res = data as { ok?: boolean; error?: string } | null;
    if (error || !res?.ok) {
      setMsg(
        res?.error === "insufficient_wallet"
          ? "Solde portefeuille insuffisant — rechargez puis réessayez."
          : "Échec de la souscription. Réessayez."
      );
      return;
    }
    await load();
  }

  async function cancel() {
    setBusy(true);
    setMsg(null);
    const sb = createClient();
    await sb.rpc("priority_sub_cancel");
    setBusy(false);
    await load();
  }

  if (!state || !state.partner) return null;

  const active = state.is_priority;
  const price = state.price_da ?? state.monthly_da ?? 0;

  return (
    <div className="border-border overflow-hidden rounded-2xl border bg-white">
      <div className="flex items-center gap-2 bg-gradient-to-r from-[#5B2EFF] to-[#6C2BD9] px-4 py-3 text-white">
        <Crown className="size-5" />
        <span className="font-extrabold">Abonnement Prioritaire</span>
        {active && (
          <span className="ml-auto rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">
            Actif
          </span>
        )}
      </div>

      <div className="space-y-3 p-4">
        <ul className="space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <Zap className="text-primary-600 mt-0.5 size-4 shrink-0" />
            <span>
              <b>Proposé en premier</b> sur les courses proches — la priorité
              accélère, sans jamais te bloquer une course.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <BadgeCheck className="text-primary-600 mt-0.5 size-4 shrink-0" />
            <span>
              <b>Badge Prioritaire</b> visible par le client.
            </span>
          </li>
        </ul>

        {active ? (
          <div>
            <p className="text-muted text-sm">
              Actif jusqu&apos;au{" "}
              <b>
                {state.period_end
                  ? new Date(state.period_end).toLocaleDateString("fr-DZ")
                  : "—"}
              </b>
              .
            </p>
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className="text-danger-600 mt-2 text-sm font-semibold hover:underline disabled:opacity-50"
            >
              Résilier
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm">
              <b className="text-lg">{price} DA</b>{" "}
              <span className="text-muted">
                {state.eligible_first_month ? "le 1er mois, puis " : ""}
                {state.eligible_first_month
                  ? `${state.monthly_da} DA/mois`
                  : "/ mois"}
              </span>
            </p>
            <button
              type="button"
              onClick={subscribe}
              disabled={busy}
              className="bg-primary-600 mt-2 w-full rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? "…" : "Devenir Prioritaire (portefeuille)"}
            </button>
          </div>
        )}

        {msg && <p className="text-danger-600 text-sm font-medium">{msg}</p>}
      </div>
    </div>
  );
}
