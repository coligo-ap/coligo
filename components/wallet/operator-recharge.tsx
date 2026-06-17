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
export function OperatorRecharge({
  hideBalance = false,
  title = "Recharger mon portefeuille",
}: {
  hideBalance?: boolean;
  title?: string;
} = {}) {
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
  // Verrou SYNCHRONE anti double-tap : `busy` (state React) ne se met à jour
  // qu'au prochain rendu, donc deux clics dans le même tick lisent tous deux
  // `busy=false` et passeraient. Un ref se règle immédiatement → 2e clic bloqué.
  const submittingRef = useRef(false);

  const refresh = useCallback(async () => {
    const [st, en] = await Promise.all([
      getMyWalletState(),
      getMyWalletEntries(),
    ]);
    setState(st);
    setEntries(en);
    setLoading(false);
    return { st, en };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Retour Chargily : on NE croit JAMAIS la redirection `?topup=success` (le
  // client peut la forger). La SEULE preuve de paiement est l'écriture
  // `topup_chargily` posée par le webhook (signature HMAC vérifiée + idempotente).
  // On attend donc qu'une telle écriture apparaisse, créée APRÈS le clic « Payer »
  // (horodatage mémorisé en localStorage, partagé entre onglets). Robuste au
  // webhook rapide (crédit déjà posé au retour) comme lent (jusqu'à ~60 s).
  useEffect(() => {
    const flag = search.get("topup");
    if (!flag) return;
    router.replace(pathname);
    let startedAt = 0;
    try {
      const raw = window.localStorage.getItem("coligo_op_topup_started");
      startedAt = raw ? Number(raw) : 0;
      window.localStorage.removeItem("coligo_op_topup_started");
    } catch {
      /* localStorage indisponible : on se rabat sur une fenêtre récente */
    }
    if (flag === "failed") {
      setTopupReturn("failed");
      return;
    }
    if (flag !== "success") return;
    setTopupReturn("checking");
    // Marge de 90 s sous l'horodatage du clic pour absorber un léger écart
    // d'horloge client/serveur ; à défaut d'horodatage, fenêtre de 10 min.
    const since = startedAt > 0 ? startedAt - 90_000 : Date.now() - 600_000;
    const credited = (en: MyWalletEntry[]) =>
      en.some(
        (e) =>
          e.type === "topup_chargily" &&
          new Date(e.createdAt).getTime() >= since
      );
    let tries = 0;
    const tick = async () => {
      tries += 1;
      const { en } = await refresh();
      if (credited(en)) {
        setTopupReturn("confirmed");
        if (pollRef.current) clearInterval(pollRef.current);
      } else if (tries >= 20) {
        if (pollRef.current) clearInterval(pollRef.current);
        setTopupReturn(null);
      }
    };
    void tick(); // 1re vérification immédiate (cas webhook déjà passé)
    pollRef.current = setInterval(() => void tick(), 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const amt = Number(amount);
  const amtValid = Number.isFinite(amt) && amt >= 100;

  const payCard = async () => {
    if (!amtValid || busy || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await createOperatorTopupCheckout(amt, pathname);
      if (!res.ok || !res.url) {
        setErr(res.error ?? "Paiement indisponible.");
        return;
      }
      // Horodatage du clic → sert de borne à la détection du crédit au retour.
      try {
        window.localStorage.setItem(
          "coligo_op_topup_started",
          String(Date.now())
        );
      } catch {
        /* localStorage indisponible : la détection se rabattra sur une fenêtre récente */
      }
      // MÊME onglet (et non `_blank`) : le retour `?topup=success` atterrit alors
      // sur CETTE page (fiable sur l'APK Capacitor comme sur le web), où le
      // polling affiche la confirmation. `_blank` ouvrait le navigateur système
      // et l'onglet d'origine restait bloqué sur « en cours ».
      window.location.href = res.url;
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  const submitManual = async () => {
    if (!amtValid || !file || !state || busy || submittingRef.current) return;
    submittingRef.current = true;
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
        return;
      }
      const res = await requestOperatorManualTopup({
        method,
        amountDa: amt,
        proofPath: path,
      });
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
      setErr("Une erreur est survenue.");
    } finally {
      submittingRef.current = false;
      setBusy(false);
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
      {!hideBalance && (
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
      )}

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
      <div
        className={`border-border bg-surface rounded-[16px] border p-4 shadow-sm ${hideBalance ? "" : "mt-3"}`}
      >
        <h2 className="text-foreground mb-3 text-sm font-bold">{title}</h2>

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
