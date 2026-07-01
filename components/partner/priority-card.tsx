"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Crown,
  Zap,
  BadgeCheck,
  Wallet,
  CreditCard,
  LifeBuoy,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { subscribePriorityCard } from "@/components/partner/priority-actions";
import {
  isSupportConfigured,
  openSupportChat,
} from "@/components/support/tawk-chat";

// =============================================================================
// Carte « Abonnement Prioritaire » — commune livreur + chauffeur (ch.7).
// Paiement ADAPTATIF (Uber-style) : si le solde Coligo Pay couvre l'abonnement →
// paiement instantané au portefeuille ; sinon → carte bancaire (instantanée) +
// possibilité de recharger le portefeuille. On ne laisse jamais l'utilisateur
// sans option claire. Dark-aware via les tokens (.bg-white suit la surface sombre
// sous .drive-jakarta / [data-space=client], cf. globals.css).
// =============================================================================

type State = {
  partner: boolean;
  subject_type?: "chauffeur" | "driver";
  is_priority?: boolean;
  status?: string;
  period_end?: string | null;
  price_da?: number;
  monthly_da?: number;
  eligible_first_month?: boolean;
  wallet_balance?: number;
};

const fmtDA = (n: number) => n.toLocaleString("fr-FR").replace(/ | /g, " ");

export function PriorityCard() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<null | "wallet" | "card">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    const sb = createClient();
    const { data } = await sb.rpc("my_priority_state");
    setState((data as State) ?? { partner: false });
  }
  useEffect(() => {
    load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const rechargeHref =
    state?.subject_type === "driver"
      ? "/driver/recharger"
      : "/chauffeur/recharger";
  const returnPath =
    state?.subject_type === "driver"
      ? "/driver/parametres"
      : "/chauffeur/abonnement";

  // Paiement au PORTEFEUILLE (instantané).
  async function payWallet() {
    setBusy("wallet");
    setMsg(null);
    const sb = createClient();
    const { data, error } = await sb.rpc("priority_subscribe", {
      p_payment_method: "wallet",
    });
    setBusy(null);
    const res = data as { ok?: boolean; error?: string } | null;
    if (error || !res?.ok) {
      setMsg(
        res?.error === "insufficient_wallet"
          ? "Solde Coligo Pay insuffisant — payez par carte ou rechargez votre portefeuille."
          : "Échec de la souscription. Réessayez ou contactez le support."
      );
      await load();
      return;
    }
    await load();
  }

  // Paiement par CARTE (Chargily, nouvel onglet) → on POLLE l'activation (webhook).
  async function payCard() {
    setBusy("card");
    setMsg(null);
    const res = await subscribePriorityCard(returnPath);
    setBusy(null);
    if (!res.ok || !res.url) {
      setMsg(res.error ?? "Paiement carte indisponible.");
      return;
    }
    window.open(res.url, "_blank");
    setMsg(
      "Paiement carte en cours — rien n'est activé tant que la banque n'a pas confirmé. Cette carte se met à jour automatiquement."
    );
    setPolling(true);
    let tries = 0;
    pollRef.current = setInterval(async () => {
      tries += 1;
      await load();
      const sb = createClient();
      const { data } = await sb.rpc("my_priority_state");
      const st = data as State | null;
      if ((st?.is_priority || st?.status === "active") && pollRef.current) {
        clearInterval(pollRef.current);
        setPolling(false);
        setMsg(null);
      } else if (tries >= 15 && pollRef.current) {
        clearInterval(pollRef.current);
        setPolling(false);
      }
    }, 3000);
  }

  async function cancel() {
    setBusy("wallet");
    setMsg(null);
    const sb = createClient();
    await sb.rpc("priority_sub_cancel");
    setBusy(null);
    await load();
  }

  const contactSupport = () =>
    openSupportChat({
      attributes: {
        sujet: "Pass Prioritaire",
        espace: state?.subject_type === "driver" ? "Livreur" : "Chauffeur",
      },
    });

  if (!state || !state.partner) return null;

  const active = state.is_priority;
  const amount = state.price_da ?? state.monthly_da ?? 0;
  const balance = state.wallet_balance ?? 0;
  const covers = balance >= amount;

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
              <b className="text-foreground">
                {state.period_end
                  ? new Date(state.period_end).toLocaleDateString("fr-DZ")
                  : "—"}
              </b>
              .
            </p>
            <button
              type="button"
              onClick={cancel}
              disabled={busy != null}
              className="text-danger-600 mt-2 text-sm font-semibold hover:underline disabled:opacity-50"
            >
              Résilier
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {/* Prix (promo 1er mois si éligible). */}
            <p className="text-sm">
              <b className="text-lg">{fmtDA(amount)} DA</b>{" "}
              <span className="text-muted">
                {state.eligible_first_month
                  ? `le 1er mois, puis ${fmtDA(state.monthly_da ?? 0)} DA/mois`
                  : "/ mois"}
              </span>
            </p>

            {/* Solde Coligo Pay + verdict de couverture. */}
            <div className="bg-surface-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs">
              <Wallet className="text-primary-600 size-4 shrink-0" />
              <span className="text-muted">
                Solde Coligo Pay :{" "}
                <b className="text-foreground">{fmtDA(balance)} DA</b>
              </span>
              <span
                className={`ml-auto rounded-full px-2 py-0.5 font-bold ${
                  covers
                    ? "bg-success-50 text-success-700"
                    : "bg-warning-50 text-warning-700"
                }`}
              >
                {covers ? "couvre l’abonnement" : "insuffisant"}
              </span>
            </div>

            {/* PAIEMENT ADAPTATIF : la meilleure option d'abord, les autres restent
                visibles pour ne jamais bloquer la compréhension. */}
            {covers ? (
              <>
                <button
                  type="button"
                  onClick={payWallet}
                  disabled={busy != null || polling}
                  className="bg-primary-600 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-50"
                >
                  {busy === "wallet" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Wallet className="size-4" />
                  )}
                  Payer avec mon solde Coligo Pay · instantané
                </button>
                <button
                  type="button"
                  onClick={payCard}
                  disabled={busy != null || polling}
                  className="border-border text-foreground flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-bold disabled:opacity-50"
                >
                  {busy === "card" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CreditCard className="size-4" />
                  )}
                  Ou payer par carte bancaire
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={payCard}
                  disabled={busy != null || polling}
                  className="bg-primary-600 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-50"
                >
                  {busy === "card" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CreditCard className="size-4" />
                  )}
                  Payer par carte bancaire · activation immédiate
                </button>
                <Link
                  href={rechargeHref}
                  prefetch
                  className="border-primary-600 text-primary-700 flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-bold"
                >
                  <Wallet className="size-4" />
                  Recharger mon portefeuille (CIB / CCP / agent)
                </Link>
              </>
            )}
          </div>
        )}

        {(msg || polling) && (
          <p className="text-muted flex items-center gap-2 text-sm font-medium">
            {polling && (
              <Loader2 className="text-primary-600 size-4 shrink-0 animate-spin" />
            )}
            {msg}
          </p>
        )}

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
