"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Crown, Zap, BadgeCheck, Wallet, LifeBuoy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  isSupportConfigured,
  openSupportChat,
} from "@/components/support/tawk-chat";

// =============================================================================
// Carte « Abonnement Prioritaire » — commune livreur + chauffeur (ch.7).
// Paiement depuis le portefeuille opérateur (instantané). 2 avantages livrés :
// priorité dispatch + badge (« zones à forte demande » non annoncé tant que non
// livré). La priorité accélère mais ne bloque jamais.
// =============================================================================

type State = {
  partner: boolean;
  subject_type?: "chauffeur" | "driver";
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
  // true quand le solde est insuffisant : on propose de RECHARGER (jamais
  // d'accès au pass sans paiement effectif).
  const [needRecharge, setNeedRecharge] = useState(false);

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
    setNeedRecharge(false);
    const sb = createClient();
    // Paiement EXCLUSIVEMENT depuis le portefeuille Coligo Pay (float opérateur,
    // débité immédiatement). Le RPG ne pose `is_priority` qu'après débit réussi.
    const { data, error } = await sb.rpc("priority_subscribe", {
      p_payment_method: "wallet",
    });
    setBusy(false);
    const res = data as { ok?: boolean; error?: string } | null;
    if (error || !res?.ok) {
      if (res?.error === "insufficient_wallet") {
        setNeedRecharge(true);
        setMsg(
          "Solde Coligo Pay insuffisant — rechargez votre portefeuille puis réessayez."
        );
      } else {
        setMsg("Échec de la souscription. Réessayez ou contactez le support.");
      }
      return;
    }
    await load();
  }

  // Route de recharge selon l'acteur (livreur / chauffeur).
  const rechargeHref =
    state?.subject_type === "driver"
      ? "/driver/recharger"
      : "/chauffeur/recharger";

  const contactSupport = () =>
    openSupportChat({
      attributes: {
        sujet: "Pass Prioritaire",
        espace: state?.subject_type === "driver" ? "Livreur" : "Chauffeur",
      },
    });

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
              {busy ? "…" : "Payer avec mon solde Coligo Pay"}
            </button>
            <p className="text-muted mt-1.5 text-center text-xs">
              Réglé depuis votre portefeuille Coligo Pay — aucun accès tant que
              le paiement n&apos;est pas débité.
            </p>
          </div>
        )}

        {msg && <p className="text-danger-600 text-sm font-medium">{msg}</p>}

        {/* Solde insuffisant → on RECHARGE le portefeuille (modes de recharge
            disponibles), on ne donne jamais le pass sans paiement. */}
        {needRecharge && (
          <Link
            href={rechargeHref}
            prefetch
            className="border-primary-600 text-primary-700 flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-bold"
          >
            <Wallet className="size-4" />
            Recharger mon portefeuille
          </Link>
        )}

        {/* Contacter le support (chat Tawk si actif, sinon e-mail). */}
        {isSupportConfigured() && (
          <button
            type="button"
            onClick={contactSupport}
            className="text-muted hover:text-primary-700 flex w-full items-center justify-center gap-1.5 text-xs font-semibold"
          >
            <LifeBuoy className="size-3.5" />
            Un souci de paiement ? Contacter le support
          </button>
        )}
      </div>
    </div>
  );
}
