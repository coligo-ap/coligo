"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import {
  createOperatorTopupCheckout,
  getMyTopupConfig,
  getMyWalletEntries,
  getMyWalletState,
  requestOperatorManualTopup,
  type MyWalletEntry,
  type MyWalletState,
  type TopupConfig,
} from "@/app/wallet/recharge-actions";
import { RECHARGE_STYLE } from "@/components/wallet/operator-recharge.style";
import { openCheckout } from "@/lib/payments/open-checkout";
import {
  isSupportConfigured,
  openSupportChat,
} from "@/components/support/tawk-chat";
import {
  STR,
  OWNER_BADGE,
  OWNER_CTX,
  ENTRY_LABEL,
  FINANCE_LABEL,
  type Lang,
  type Owner,
} from "./operator-recharge-strings";
import { Ico } from "./operator-recharge-icons";
import { CashFinder } from "./operator-recharge-cash-finder";

/** Groupement des milliers manuel (cohérent SSR/CSR, cf. formatDA). */
function groupNum(n: number): string {
  return Math.abs(Math.round(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

type Method = "card" | "ccp" | "cash";

/**
 * Page « Mon portefeuille » — recharge du portefeuille opérateur (livreur /
 * chauffeur / commerçant / partenaire), reproduction fidèle de la maquette.
 * Solde (HERO), recharge Carte (Chargily) / Virement CCP (preuve) / Espèces
 * (agents Coligo Pay), et dernières opérations. Réutilisable dans tous les
 * espaces (la barre de navigation du bas reste celle du shell hôte).
 */
export function OperatorRecharge({
  compact = false,
  inHub = false,
  title,
}: {
  /** Mode encart (portail partenaire) : masque le HERO, le titre de page et
   *  l'historique — le portail affiche déjà son propre solde et historique. */
  compact?: boolean;
  /** Onglet du hub Argent (Gains·Courses·Coligo Pay / Finances·Stats·Coligo
   *  Pay) : masque la ligne « Retour + Mon portefeuille » — les onglets
   *  donnent déjà le contexte et la navigation (zéro doublon). */
  inHub?: boolean;
  /** Titre de section personnalisé (sinon « Recharger mon solde »). */
  title?: string;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const locale = useLocale();
  const lang: Lang = locale === "ar" ? "ar" : "fr";
  const t = STR[lang];
  const dir = lang === "ar" ? "rtl" : "ltr";

  const [state, setState] = useState<MyWalletState | null>(null);
  const [entries, setEntries] = useState<MyWalletEntry[]>([]);
  const [config, setConfig] = useState<TopupConfig | null>(null);
  const [loading, setLoading] = useState(true);

  // Moyen PRÉ-SÉLECTIONNABLE via l'URL (?method=ccp|cash|card) — la feuille
  // d'abonnement y renvoie quand le solde ne couvre pas l'offre, pour que
  // l'utilisateur comprenne immédiatement l'étape suivante.
  const [method, setMethod] = useState<Method>(() => {
    const m = search.get("method");
    return m === "ccp" || m === "cash" || m === "card" ? m : "card";
  });
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<"ccp" | "rib" | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [topupReturn, setTopupReturn] = useState<
    "checking" | "confirmed" | "failed" | null
  >(null);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittingRef = useRef(false);

  // Masquer/afficher le solde (affiché par défaut, choix mémorisé localement).
  const [hideBalance, setHideBalance] = useState(false);
  useEffect(() => {
    try {
      setHideBalance(window.localStorage.getItem("coligo_pay_hide") === "1");
    } catch {
      /* localStorage indisponible */
    }
  }, []);
  const toggleBalance = () =>
    setHideBalance((v) => {
      const n = !v;
      try {
        window.localStorage.setItem("coligo_pay_hide", n ? "1" : "0");
      } catch {
        /* localStorage indisponible */
      }
      return n;
    });

  // Filtres d'historique (type + mois / période libre) — appliqués sur les
  // écritures chargées (RPC scopée auth.uid, « Voir plus » étend jusqu'à 200).
  type OpsKind =
    | "all"
    | "recharge"
    | "vente"
    | "commission"
    | "cashback"
    | "autre";
  const [opsKind, setOpsKind] = useState<OpsKind>("all");
  const [opsMonth, setOpsMonth] = useState<string>("all");
  const [opsFrom, setOpsFrom] = useState("");
  const [opsTo, setOpsTo] = useState("");

  // Historique progressif (« Voir plus ») — borné 200 côté serveur.
  const [opsLimit, setOpsLimit] = useState(20);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsAllLoaded, setOpsAllLoaded] = useState(false);
  const loadMoreOps = async () => {
    if (opsLoading) return;
    setOpsLoading(true);
    try {
      const next = Math.min(200, opsLimit + 40);
      const en = await getMyWalletEntries(next);
      setEntries(en);
      setOpsAllLoaded(en.length < next || next >= 200);
      setOpsLimit(next);
    } finally {
      setOpsLoading(false);
    }
  };

  const refresh = useCallback(async () => {
    try {
      const [st, en] = await Promise.all([
        getMyWalletState(),
        getMyWalletEntries(),
      ]);
      setState(st);
      setEntries(en);
      return { st, en };
    } catch {
      // Réseau/auth KO : on N'enferme PAS l'écran dans un spinner infini.
      return { st: null, en: [] as MyWalletEntry[] };
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void getMyTopupConfig().then(setConfig);
  }, [refresh]);

  // Attente de la CONFIRMATION réelle (écriture topup_chargily du webhook depuis
  // `sinceMs`) — partagée entre le retour WEB (?topup=success) et le paiement
  // NATIF dans le navigateur intégré (l'app reste montée dessous). On ne croit
  // JAMAIS la redirection (forgeable) : seule l'écriture HMAC fait foi.
  const beginTopupPoll = useCallback(
    (sinceMs: number) => {
      setTopupReturn("checking");
      const credited = (en: MyWalletEntry[]) =>
        en.some(
          (e) =>
            e.type === "topup_chargily" &&
            new Date(e.createdAt).getTime() >= sinceMs
        );
      let tries = 0;
      const tick = async () => {
        tries += 1;
        const { en } = await refresh();
        if (credited(en)) {
          setTopupReturn("confirmed");
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (tries >= 40) {
          if (pollRef.current) clearInterval(pollRef.current);
          setTopupReturn(null);
        }
      };
      void tick();
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => void tick(), 3000);
    },
    [refresh]
  );

  // Retour Chargily WEB (redirection ?topup=). En natif il n'y a pas de retour :
  // le poll est lancé directement après l'ouverture (voir payCard).
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
      /* localStorage indisponible */
    }
    if (flag === "failed") {
      setTopupReturn("failed");
      return;
    }
    if (flag !== "success") return;
    beginTopupPoll(startedAt > 0 ? startedAt - 90_000 : Date.now() - 600_000);
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
        setErr(res.error ?? t.payUnavailable);
        return;
      }
      const started = Date.now();
      try {
        window.localStorage.setItem("coligo_op_topup_started", String(started));
      } catch {
        /* localStorage indisponible */
      }
      // Navigateur intégré en APK (l'app reste montée → on polle la
      // confirmation ici même), redirection sur le web (retour via ?topup=).
      const opened = await openCheckout(res.url);
      if (opened === "inapp") beginTopupPoll(started - 90_000);
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
        setErr(`${t.uploadFail} : ${upErr.message}`);
        return;
      }
      const res = await requestOperatorManualTopup({
        method: "virement",
        amountDa: amt,
        proofPath: path,
      });
      if (!res.ok) {
        setErr(res.error ?? t.requestFail);
        return;
      }
      setFile(null);
      setAmount("");
      setMsg(t.sentMsg);
      void refresh();
    } catch {
      setErr(t.genericErr);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  const copyVal = async (key: "ccp" | "rib", text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard indisponible */
    }
  };

  const owner: Owner = ((): Owner => {
    const o = state?.ownerType;
    return o === "chauffeur" || o === "merchant" || o === "partner"
      ? o
      : "driver";
  })();
  const presets = config?.presets ?? [500, 1000, 2000, 5000];

  // « Retirer » : chaque rôle a DÉJÀ son flux de règlement sécurisé — on y
  // route (pas de retrait direct inventé côté wallet).
  const withdrawHref =
    owner === "merchant"
      ? "/finances"
      : owner === "chauffeur"
        ? "/chauffeur/gains"
        : owner === "driver"
          ? "/driver/gains"
          : null;

  // Classification TRAÇABLE d'une écriture (recharge / commission / cashback).
  const kindOf = (e: MyWalletEntry): Exclude<OpsKind, "all"> => {
    if (e.type.startsWith("topup")) return "recharge";
    const key = e.type === "finance_mirror" ? (e.note ?? "") : e.type;
    // Ventes en ligne (commande payée en ligne / QR encaissé pour le commerçant).
    if (key === "sale" || key === "delivery_revenue") return "vente";
    if (
      key.includes("commission") ||
      key === "service_fee" ||
      key === "cod_settle"
    )
      return "commission";
    if (key === "wallet_redemption" || key === "cashback") return "cashback";
    return "autre";
  };
  const monthsAvailable = [
    ...new Set(entries.map((e) => String(e.createdAt).slice(0, 7))),
  ];
  const filteredEntries = entries.filter((e) => {
    if (opsKind !== "all" && kindOf(e) !== opsKind) return false;
    const day = String(e.createdAt).slice(0, 10);
    if (opsMonth === "custom") {
      if (opsFrom && day < opsFrom) return false;
      if (opsTo && day > opsTo) return false;
      return true;
    }
    if (opsMonth !== "all") return day.startsWith(opsMonth);
    return true;
  });
  const KIND_LABEL: Record<Exclude<OpsKind, "all">, [string, string]> = {
    recharge: ["Recharges", "الشحن"],
    vente: ["Ventes en ligne", "مبيعات عبر الإنترنت"],
    commission: ["Commissions", "العمولات"],
    cashback: ["Cashback", "كاش باك"],
    autre: ["Autres", "أخرى"],
  };

  if (loading) {
    return (
      <section className="cgw" dir={dir}>
        <style>{RECHARGE_STYLE}</style>
        <div className="cgw-load">
          <span className="cgw-load-ic">{Ico.spinner}</span>
        </div>
      </section>
    );
  }
  // Jamais d'écran BLANC : si l'état du portefeuille n'a pas pu être chargé
  // (réseau/session), on propose un « Réessayer » au lieu de rendre null.
  if (!state) {
    return (
      <section className="cgw" dir={dir}>
        <style>{RECHARGE_STYLE}</style>
        <div
          className="cgw-load"
          style={{ flexDirection: "column", gap: 14, padding: 24 }}
        >
          <p style={{ textAlign: "center", fontWeight: 600 }}>
            {lang === "ar"
              ? "تعذّر تحميل محفظتك. تحقّق من اتصالك."
              : "Impossible de charger votre portefeuille Coligo Pay. Vérifiez votre connexion."}
          </p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void refresh();
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 12,
              background: "var(--cg-brand, #6C2BD9)",
              color: "#fff",
              fontWeight: 700,
            }}
          >
            {lang === "ar" ? "إعادة المحاولة" : "Réessayer"}
          </button>
        </div>
      </section>
    );
  }

  // Retour ADAPTÉ à chaque utilisateur : on revient là d'où il vient (historique)
  // et, à défaut (accès direct par URL), sur l'accueil de SON espace selon le rôle.
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    const home =
      state.ownerType === "merchant"
        ? "/dashboard"
        : state.ownerType === "driver"
          ? "/driver"
          : state.ownerType === "chauffeur"
            ? "/chauffeur"
            : "/partenaire";
    router.push(home);
  };

  return (
    <section className="cgw" dir={dir}>
      <style>{RECHARGE_STYLE}</style>

      {!compact && !inHub && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <button
            type="button"
            onClick={goBack}
            aria-label={lang === "ar" ? "رجوع" : "Retour"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 12,
              border: "1.5px solid var(--cgw-line, rgba(0,0,0,.12))",
              background: "transparent",
              color: "inherit",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: lang === "ar" ? "scaleX(-1)" : undefined }}
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span>{lang === "ar" ? "رجوع" : "Retour"}</span>
          </button>
          <div className="ph1" style={{ margin: 0 }}>
            {t.title}
          </div>
        </div>
      )}

      {/* HERO solde */}
      {!compact && (
        <div className="hero">
          <div className="top">
            <div className="wic">{Ico.wallet}</div>
            <div>
              <div className="lbl">{t.balanceLabel}</div>
            </div>
            <div className="ptag">
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 11l2-6h10l2 6M5 11h14v6H5z" />
              </svg>
              {OWNER_BADGE[lang][owner]}
            </div>
          </div>
          <div
            className="amt"
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <span>
              {hideBalance ? (
                "•••••"
              ) : (
                <>
                  {groupNum(state.effectiveBalanceDa)} <small>DA</small>
                </>
              )}
            </span>
            {/* Masquer/afficher le solde (mémorisé). */}
            <button
              type="button"
              onClick={toggleBalance}
              aria-label={
                hideBalance
                  ? lang === "ar"
                    ? "إظهار الرصيد"
                    : "Afficher le solde"
                  : lang === "ar"
                    ? "إخفاء الرصيد"
                    : "Masquer le solde"
              }
              style={{
                background: "rgba(255,255,255,.16)",
                border: 0,
                borderRadius: 10,
                padding: "6px 8px",
                cursor: "pointer",
                color: "#fff",
                display: "inline-flex",
                flex: "none",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {hideBalance ? (
                  <>
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                ) : (
                  <>
                    <path d="M17.94 17.94A10.9 10.9 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M1 1l22 22" />
                  </>
                )}
              </svg>
            </button>
          </div>
          <div className="ctx">
            {Ico.info}
            <span>{OWNER_CTX[lang][owner]}</span>
          </div>
          {/* Retirer : route vers le flux de règlement SÉCURISÉ du rôle. */}
          {withdrawHref && (
            <button
              type="button"
              onClick={() => router.push(withdrawHref)}
              style={{
                marginTop: 12,
                width: "100%",
                padding: "10px 0",
                borderRadius: 12,
                border: "1.5px solid rgba(255,255,255,.35)",
                background: "rgba(255,255,255,.12)",
                color: "#fff",
                fontWeight: 700,
                fontSize: 13.5,
                cursor: "pointer",
              }}
            >
              {lang === "ar" ? "سحب / تسوية ←" : "Retirer / règlement →"}
            </button>
          )}
        </div>
      )}

      {/* Retour Chargily (inline) */}
      {topupReturn === "checking" && (
        <div className="cgw-ret">
          <span className="cgw-ret-ic">{Ico.spinner}</span>
          {t.checking}
        </div>
      )}
      {topupReturn === "confirmed" && (
        <div className="cgw-ret ok">
          {Ico.check} {t.confirmed}
        </div>
      )}
      {topupReturn === "failed" && <div className="cgw-ret ko">{t.failed}</div>}

      {/* Sélecteur de méthode */}
      <div className="secT">{title ?? t.rechargeTitle}</div>
      <div className="methods">
        <div
          className={method === "card" ? "m on" : "m"}
          onClick={() => setMethod("card")}
        >
          <div className="mi">{Ico.card}</div>
          <b>{t.mCard}</b>
          <span>{t.mCardDelay}</span>
          <span className="badge-i">{t.fast}</span>
        </div>
        <div
          className={method === "ccp" ? "m on" : "m"}
          onClick={() => setMethod("ccp")}
        >
          <div className="mi">{Ico.bank}</div>
          <b>{t.mCcp}</b>
          <span>{t.mCcpDelay}</span>
        </div>
        <div
          className={method === "cash" ? "m on" : "m"}
          onClick={() => setMethod("cash")}
        >
          <div className="mi">{Ico.cash}</div>
          <b>{t.mCash}</b>
          <span>{t.mCashDelay}</span>
        </div>
      </div>

      {/* PANNEAU CARTE */}
      {method === "card" && (
        <div className="panel">
          <div className="plab">{t.amountLabel}</div>
          <div className="chips">
            {presets.map((v) => (
              <div
                key={v}
                className={Number(amount) === v ? "chip on" : "chip"}
                onClick={() => setAmount(String(v))}
              >
                {groupNum(v)} DA
              </div>
            ))}
          </div>
          <input
            className="inp"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            placeholder={t.otherAmount}
          />
          <button
            className="btn"
            type="button"
            disabled={!amtValid || busy}
            onClick={() => void payCard()}
          >
            {busy ? Ico.spinner : Ico.card}
            {t.payCard}
          </button>
          <div className="note go">
            {Ico.check}
            {t.cardNote}
          </div>
          {err && <div className="cgw-err">{err}</div>}
        </div>
      )}

      {/* PANNEAU VIREMENT / CCP */}
      {method === "ccp" && (
        <div className="panel">
          <div className="steps">
            <div className="st">
              <div className="l">
                <div className="n">1</div>
                <div className="bar" />
              </div>
              <div className="tx">{t.step1}</div>
            </div>
            <div className="st">
              <div className="l">
                <div className="n">2</div>
                <div className="bar" />
              </div>
              <div className="tx">{t.step2}</div>
            </div>
            <div className="st">
              <div className="l">
                <div className="n">3</div>
                <div className="bar" />
              </div>
              <div className="tx">{t.step3}</div>
            </div>
            <div className="st">
              <div className="l">
                <div className="n">4</div>
              </div>
              <div className="tx">{t.step4}</div>
            </div>
          </div>

          <div className="ccpbox">
            <div className="cc">
              <div className="ck">{config?.ccpName || "Coligo"}</div>
              <div className="cv">
                {config?.ccpNumber
                  ? `${config.ccpNumber}${config.ccpKey ? ` · clé ${config.ccpKey}` : ""}`
                  : t.ccpUnset}
              </div>
              <div className="cs">{t.ccpRef}</div>
            </div>
            {config?.ccpNumber && (
              <div
                className="copy"
                onClick={() =>
                  void copyVal(
                    "ccp",
                    `${config.ccpNumber}${config.ccpKey ? ` clé ${config.ccpKey}` : ""}`
                  )
                }
              >
                {copied === "ccp" ? Ico.check : Ico.copy}
              </div>
            )}
          </div>

          {/* Compte bancaire (optionnel, selon le module) */}
          {config?.bankRib && (
            <div className="ccpbox">
              <div className="cc">
                <div className="ck">
                  {t.bankLabel}
                  {config.bankName ? ` · ${config.bankName}` : ""}
                </div>
                <div className="cv">{config.bankRib}</div>
                <div className="cs">{t.bankRibRef}</div>
              </div>
              <div
                className="copy"
                onClick={() => void copyVal("rib", config.bankRib ?? "")}
              >
                {copied === "rib" ? Ico.check : Ico.copy}
              </div>
            </div>
          )}

          <input
            className="inp"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            placeholder={t.amountSent}
            style={{ marginBottom: 11 }}
          />

          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            hidden
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <div
            className={file ? "drop done" : "drop"}
            onClick={() => fileRef.current?.click()}
          >
            <div className="di">{file ? Ico.check : Ico.image}</div>
            <b>{file ? t.proofAdded : t.addProof}</b>
            <span>{file ? `${file.name} ${t.proofReplace}` : t.proofHint}</span>
          </div>

          <button
            className="btn green"
            type="button"
            disabled={!amtValid || !file || busy}
            onClick={() => void submitManual()}
          >
            {busy ? Ico.spinner : Ico.send}
            {t.sendRequest}
          </button>
          <div className="note">
            {Ico.clock}
            {t.ccpNote}
          </div>
          {msg && <div className="cgw-ok">{msg}</div>}
          {err && <div className="cgw-err">{err}</div>}
        </div>
      )}

      {/* PANNEAU ESPÈCES */}
      {method === "cash" && (
        <div className="panel">
          <div className="plab">{t.cashTitle}</div>
          <CashFinder t={t} />
          <div className="note">
            {Ico.info}
            {t.cashNote}
          </div>
        </div>
      )}

      {/* OPÉRATIONS — filtrables par TYPE (recharge / commission / cashback)
          et par PÉRIODE (mois ou dates libres) : tout est traçable. */}
      {!compact && entries.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="plab plab-sora">{t.opsTitle}</div>

          {/* Filtre type */}
          <div className="chips" style={{ marginBottom: 8 }}>
            <div
              className={opsKind === "all" ? "chip on" : "chip"}
              onClick={() => setOpsKind("all")}
            >
              {lang === "ar" ? "الكل" : "Tout"}
            </div>
            {(
              ["recharge", "vente", "commission", "cashback", "autre"] as const
            ).map((k) => (
              <div
                key={k}
                className={opsKind === k ? "chip on" : "chip"}
                onClick={() => setOpsKind(k)}
              >
                {KIND_LABEL[k][lang === "ar" ? 1 : 0]}
              </div>
            ))}
          </div>

          {/* Filtre période : mois disponibles + dates personnalisées */}
          <select
            className="inp"
            value={opsMonth}
            onChange={(e) => setOpsMonth(e.target.value)}
            style={{ marginBottom: 8 }}
          >
            <option value="all">
              {lang === "ar" ? "كل الفترات" : "Toutes les périodes"}
            </option>
            {monthsAvailable.map((m) => (
              <option key={m} value={m}>
                {new Date(`${m}-01T00:00:00Z`).toLocaleDateString(
                  lang === "ar" ? "ar-DZ" : "fr-FR",
                  { month: "long", year: "numeric", timeZone: "UTC" }
                )}
              </option>
            ))}
            <option value="custom">
              {lang === "ar" ? "فترة مخصّصة…" : "Dates personnalisées…"}
            </option>
          </select>
          {opsMonth === "custom" && (
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                type="date"
                className="inp"
                value={opsFrom}
                onChange={(e) => setOpsFrom(e.target.value)}
                aria-label={lang === "ar" ? "من" : "Du"}
              />
              <input
                type="date"
                className="inp"
                value={opsTo}
                onChange={(e) => setOpsTo(e.target.value)}
                aria-label={lang === "ar" ? "إلى" : "Au"}
              />
            </div>
          )}

          {filteredEntries.length === 0 && (
            <p style={{ fontSize: 12.5, opacity: 0.7, padding: "8px 0" }}>
              {lang === "ar"
                ? "لا عمليات لهذا التصفية."
                : "Aucune opération pour ce filtre."}
            </p>
          )}
          {filteredEntries.map((e, i) => {
            const credit = e.amountDa >= 0;
            // Opérations finance (commande/commission/versement…) : le libellé
            // vient du `note` ; les recharges/opérations wallet : du `type`.
            const label =
              e.type === "finance_mirror"
                ? (FINANCE_LABEL[lang][e.note ?? ""] ?? e.note ?? e.type)
                : (ENTRY_LABEL[lang][e.type] ?? e.type);
            return (
              <div className="op" key={i}>
                <div className={`oi ${credit ? "cr" : "db"}`}>
                  {credit ? Ico.up : Ico.down}
                </div>
                <div className="om">
                  <b>{label}</b>
                  <span>
                    {new Date(e.createdAt).toLocaleDateString(
                      lang === "ar" ? "ar-DZ" : "fr-DZ"
                    )}
                  </span>
                </div>
                <div className={`ov ${credit ? "cr" : "db"}`}>
                  {credit ? "+" : "−"}
                  {groupNum(e.amountDa)} DA
                </div>
              </div>
            );
          })}
          {/* Historique COMPLET sur la même page : chargement progressif
              (borné 200 côté serveur, RPC scopée auth.uid). */}
          {!opsAllLoaded && entries.length >= opsLimit && (
            <button
              type="button"
              disabled={opsLoading}
              onClick={() => void loadMoreOps()}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "10px 0",
                borderRadius: 12,
                border: "1.5px solid var(--cgw-line, rgba(0,0,0,.12))",
                background: "transparent",
                color: "inherit",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                opacity: opsLoading ? 0.6 : 1,
              }}
            >
              {opsLoading
                ? "…"
                : lang === "ar"
                  ? "عرض المزيد"
                  : "Voir plus d'opérations"}
            </button>
          )}
        </div>
      )}

      {/* Comment ça marche — accordéon COMPACT (fermé), zéro pavé de texte. */}
      {!compact && (
        <details className="panel" style={{ marginTop: 12 }}>
          <summary
            className="plab plab-sora"
            style={{ cursor: "pointer", listStyle: "none", marginBottom: 0 }}
          >
            {lang === "ar"
              ? "كيف يعمل كوليغو باي؟"
              : "Comment fonctionne Coligo Pay ?"}
          </summary>
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {(lang === "ar"
              ? [
                  "بطاقة = رصيد فوري · تحويل CCP = تحقق خلال 24س · نقدًا لدى وكيل = فوري",
                  "كل عملية مسجّلة وغير قابلة للتعديل — رصيدك محمي ويمكن التحقق منه",
                  "الرصيد يُستعمل تلقائيًا: عمولات، اشتراكات، Pass — بدون خطوات إضافية",
                ]
              : [
                  "Carte = crédit instantané · Virement CCP = vérifié sous 24 h · Espèces chez un agent = immédiat",
                  "Chaque opération est enregistrée et infalsifiable — votre solde est protégé et vérifiable",
                  "Le solde sert automatiquement : commissions, abonnements, Pass — zéro étape en plus",
                ]
            ).map((line, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  fontSize: 12.5,
                  lineHeight: 1.45,
                }}
              >
                <span
                  style={{ color: "var(--cg-brand, #6C2BD9)", flex: "none" }}
                >
                  {Ico.check}
                </span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Contacter le support — disponible sur la page Coligo Pay (chat Tawk
          si actif, sinon repli e-mail). Masqué si aucun canal n'est configuré. */}
      {isSupportConfigured() && (
        <button
          type="button"
          className="cgw-support"
          onClick={() =>
            openSupportChat({
              attributes: {
                sujet: "Coligo Pay",
                espace: OWNER_BADGE.fr[owner],
              },
            })
          }
        >
          {Ico.info}
          {t.support}
        </button>
      )}
    </section>
  );
}
