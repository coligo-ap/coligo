"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Loader2,
  Receipt,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatDA } from "@/lib/utils";
import {
  createOperatorTopupCheckout,
  getMyWalletEntries,
  getMyWalletState,
  requestOperatorManualTopup,
  type MyWalletEntry,
  type MyWalletState,
} from "@/app/wallet/recharge-actions";

const PRESETS = [500, 1000, 2000, 5000];

const ENTRY_LABEL: Record<string, string> = {
  topup_chargily: "Recharge carte",
  topup_manual: "Recharge validée",
  topup_partner: "Recharge chez un point",
  recharge_sale: "Revente de crédit",
  bonus: "Bonus",
  fee_debit: "Frais",
  service_fee: "Frais de service",
  cod_settle: "Régularisation",
  adjustment: "Ajustement",
};

/**
 * Recharge du portefeuille opérateur (livreur / chauffeur / commerçant /
 * partenaire) : solde, recharge par carte (Chargily) ou virement/CCP avec
 * preuve, et historique. Réutilisable dans les 3 espaces.
 */
export function OperatorRecharge() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<MyWalletState | null>(null);
  const [entries, setEntries] = useState<MyWalletEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"card" | "manual">("card");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"ccp" | "virement">("ccp");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [topupReturn, setTopupReturn] = useState<
    "checking" | "confirmed" | "failed" | null
  >(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const [st, en] = await Promise.all([
      getMyWalletState(),
      getMyWalletEntries(),
    ]);
    setState(st);
    setEntries(en);
    setLoading(false);
    return st;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Retour Chargily : on NE croit PAS la redirection, on attend le webhook.
  useEffect(() => {
    const flag = search.get("topup");
    if (!flag) return;
    router.replace(pathname);
    if (flag === "failed") {
      setTopupReturn("failed");
      return;
    }
    if (flag !== "success") return;
    setTopupReturn("checking");
    const before = state?.balanceDa ?? null;
    let tries = 0;
    pollRef.current = setInterval(async () => {
      tries += 1;
      const st = await refresh();
      if (st && before != null && st.balanceDa > before) {
        setTopupReturn("confirmed");
        if (pollRef.current) clearInterval(pollRef.current);
      } else if (tries >= 15) {
        if (pollRef.current) clearInterval(pollRef.current);
        setTopupReturn(null);
      }
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const amt = Number(amount);
  const amtValid = Number.isFinite(amt) && amt >= 100;

  const payCard = async () => {
    if (!amtValid || busy) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await createOperatorTopupCheckout(amt, pathname);
    setBusy(false);
    if (!res.ok || !res.url) {
      setErr(res.error ?? "Paiement indisponible.");
      return;
    }
    window.open(res.url, "_blank");
    setMsg(
      "Paiement carte en cours — le solde se met à jour dès la confirmation bancaire."
    );
  };

  const submitManual = async () => {
    if (!amtValid || !file || !state || busy) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const supabase = createClient();
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${state.walletId}/${crypto.randomUUID()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from("wallet-proofs")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        setErr(`Téléversement échoué : ${upErr.message}`);
        setBusy(false);
        return;
      }
      const res = await requestOperatorManualTopup({
        method,
        amountDa: amt,
        proofPath: path,
      });
      setBusy(false);
      if (!res.ok) {
        setErr(res.error ?? "Échec de la demande.");
        return;
      }
      setFile(null);
      setAmount("");
      setMsg(
        "Preuve envoyée — votre recharge sera créditée après validation par Coligo."
      );
      void refresh();
    } catch {
      setBusy(false);
      setErr("Une erreur est survenue.");
    }
  };

  if (loading) {
    return (
      <div className="text-muted flex items-center justify-center gap-2 py-8 text-sm">
        <Loader2 className="size-4 animate-spin" /> Chargement…
      </div>
    );
  }

  if (!state) return null; // pas d'opérateur (ex. session non reconnue)

  const eff = state.effectiveBalanceDa;

  return (
    <section className="mx-auto mb-6 w-full max-w-md">
      {/* Solde */}
      <div className="border-border bg-surface rounded-[16px] border p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="bg-primary-50 text-primary-600 flex size-9 items-center justify-center rounded-full">
            <Wallet className="size-5" />
          </span>
          <div>
            <p className="text-muted text-xs">Solde du portefeuille</p>
            <p
              className={`text-xl font-bold tabular-nums ${eff < 0 ? "text-danger-700" : "text-foreground"}`}
            >
              {formatDA(eff)}
            </p>
          </div>
        </div>
        {state.debtDa > 0 && (
          <p className="text-muted mt-2 text-xs">
            Dont {formatDA(state.debtDa)} dûs à la plateforme.
          </p>
        )}
        {!state.canOperate && (
          <p className="text-danger-700 bg-danger-100 mt-2 flex items-start gap-2 rounded-[12px] p-2.5 text-xs">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Solde insuffisant : rechargez pour continuer à travailler.
          </p>
        )}
      </div>

      {/* Retour Chargily */}
      {topupReturn === "checking" && (
        <p className="text-muted bg-surface-2 mt-3 flex items-center gap-2 rounded-[12px] px-3 py-2.5 text-xs font-medium">
          <Loader2 className="size-4 shrink-0 animate-spin" /> Confirmation du
          paiement en cours…
        </p>
      )}
      {topupReturn === "confirmed" && (
        <p className="text-success-700 bg-success-100 mt-3 flex items-center gap-2 rounded-[12px] px-3 py-2.5 text-xs font-semibold">
          <CheckCircle2 className="size-4 shrink-0" /> Recharge confirmée !
        </p>
      )}
      {topupReturn === "failed" && (
        <p className="text-danger-700 bg-danger-100 mt-3 rounded-[12px] px-3 py-2.5 text-xs font-semibold">
          Paiement non abouti — réessayez.
        </p>
      )}

      {/* Recharger */}
      <div className="border-border bg-surface mt-3 rounded-[16px] border p-4 shadow-sm">
        <h2 className="text-foreground mb-3 text-sm font-bold">
          Recharger mon portefeuille
        </h2>

        <div className="bg-surface-2 mb-3 flex gap-1 rounded-[10px] p-1 text-sm">
          {(["card", "manual"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={
                tab === t
                  ? "bg-primary-600 flex-1 rounded-[8px] px-3 py-1.5 font-semibold text-white"
                  : "text-muted flex-1 rounded-[8px] px-3 py-1.5 font-medium"
              }
            >
              {t === "card" ? "Carte (Chargily)" : "Virement / CCP"}
            </button>
          ))}
        </div>

        {/* Montant */}
        <div className="mb-2 flex flex-wrap gap-2">
          {PRESETS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount(String(v))}
              className={
                Number(amount) === v
                  ? "border-primary-600 text-primary-700 bg-primary-50 rounded-full border px-3 py-1 text-sm font-semibold"
                  : "border-border text-foreground rounded-full border px-3 py-1 text-sm"
              }
            >
              {formatDA(v)}
            </button>
          ))}
        </div>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="numeric"
          placeholder="Montant en DA (min. 100)"
          className="border-border bg-surface mb-3 w-full rounded-[12px] border px-3 py-2 text-sm"
        />

        {tab === "card" ? (
          <button
            type="button"
            disabled={!amtValid || busy}
            onClick={() => void payCard()}
            className="bg-primary-600 inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CreditCard className="size-4" />
            )}
            Payer par carte
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              {(["ccp", "virement"] as const).map((mth) => (
                <button
                  key={mth}
                  type="button"
                  onClick={() => setMethod(mth)}
                  className={
                    method === mth
                      ? "border-primary-600 text-primary-700 bg-primary-50 flex-1 rounded-[10px] border px-3 py-1.5 text-sm font-semibold"
                      : "border-border text-foreground flex-1 rounded-[10px] border px-3 py-1.5 text-sm"
                  }
                >
                  {mth === "ccp" ? "CCP / BaridiMob" : "Virement bancaire"}
                </button>
              ))}
            </div>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-muted block w-full text-xs"
            />
            <p className="text-subtle text-xs">
              Téléversez la preuve du virement / reçu CCP. Crédité après
              validation Coligo.
            </p>
            <button
              type="button"
              disabled={!amtValid || !file || busy}
              onClick={() => void submitManual()}
              className="bg-primary-600 inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Receipt className="size-4" />
              )}
              Envoyer la preuve
            </button>
          </div>
        )}

        {msg && (
          <p className="text-success-700 mt-2 text-center text-xs font-medium">
            {msg}
          </p>
        )}
        {err && (
          <p className="text-danger-700 mt-2 text-center text-xs font-medium">
            {err}
          </p>
        )}
      </div>

      {/* Historique */}
      {entries.length > 0 && (
        <div className="border-border bg-surface mt-3 rounded-[16px] border p-4 shadow-sm">
          <h3 className="text-foreground mb-2 text-sm font-bold">
            Dernières opérations
          </h3>
          <ul className="divide-border divide-y">
            {entries.map((e, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 py-2"
              >
                <span className="text-foreground text-xs">
                  {ENTRY_LABEL[e.type] ?? e.type}
                  <span className="text-subtle block">
                    {new Date(e.createdAt).toLocaleDateString("fr-DZ")}
                  </span>
                </span>
                <span
                  className={`text-sm font-semibold tabular-nums ${e.amountDa < 0 ? "text-danger-700" : "text-success-700"}`}
                >
                  {e.amountDa > 0 ? "+" : ""}
                  {formatDA(e.amountDa)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
