"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Car,
  ChevronDown,
  History,
  Loader2,
  Plus,
  Wallet,
  Zap,
} from "lucide-react";
import { formatDA } from "@/lib/utils";
import { PartnerBackHeader } from "@/components/shared/partner-ui";
import { VIOLET, GO, RED } from "@/components/customer/drive/drive-modals";
import { PlanIcon, PLAN_LABEL, fmtPct } from "./d-ui";
import { formatOnline } from "@/lib/drive/geo";
import { getMyWalletState } from "@/app/wallet/recharge-actions";
import { registerChauffeurCacheReset } from "@/lib/chauffeur/client-cache";
import {
  getChauffeurFinances,
  getChauffeurHistory,
  type ChauffeurFinances,
  type ChauffeurHistoryRide,
} from "@/app/(chauffeur)/actions";

const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

// Cache module (SWR) : au RETOUR sur Gains / Historique, on réaffiche la
// dernière donnée INSTANTANÉMENT (plus de spinner plein écran), le refetch se
// fait en arrière-plan. Évite de re-bloquer la page à chaque navigation.
let lastFinCache: ChauffeurFinances | null = null;
let lastHistoCache: ChauffeurHistoryRide[] | null = null;
let lastBalanceCache: number | null = null;
// Vidange au changement de compte (anti-fuite sur appareil partagé).
registerChauffeurCacheReset(() => {
  lastFinCache = null;
  lastHistoCache = null;
  lastBalanceCache = null;
});

/** Gains (maquette s-dgains) : aujourd'hui + « Ce mois » + « À reverser ». */
export function DGains() {
  const router = useRouter();
  const [fin, setFin] = useState<ChauffeurFinances | null>(lastFinCache);
  const [balance, setBalance] = useState<number | null>(lastBalanceCache);

  useEffect(() => {
    void getChauffeurFinances().then((f) => {
      lastFinCache = f;
      setFin(f);
    });
    void getMyWalletState().then((s) => {
      const b = s?.effectiveBalanceDa ?? 0;
      lastBalanceCache = b;
      setBalance(b);
    });
  }, []);

  const lowBalance = balance != null && balance < 0;

  if (!fin) {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--d-surface)]">
        <Loader2 className="size-6 animate-spin" style={{ color: VIOLET }} />
      </div>
    );
  }

  const month = MONTHS[new Date().getMonth()];
  // « À reverser » ADAPTATIF selon la config réelle (aucun plan/taux en dur) :
  // au lancement (0 % de commission, sans abonnement payant) il n'y a rien à
  // reverser → message « à jour ». Sinon on liste les vraies composantes.
  const due = fin.dueUnsettled;
  const dueParts: string[] = [];
  if (fin.planRate > 0) dueParts.push("commissions sur courses");
  if (fin.monthSubFee > 0) dueParts.push("abonnement");
  const dueSub = `${dueParts.join(" + ") || "montant dû"} · avant le 5 du mois · CCP / BaridiMob`;

  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-5 pt-4 pb-24">
      <div className="mb-3 flex items-center gap-3">
        <h1 className="drive-sora flex-1 text-[21px] font-extrabold tracking-[-0.5px]">
          Gains
        </h1>
        <button
          type="button"
          onClick={() => router.push("/chauffeur/historique")}
          className="flex items-center gap-1.5 rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] px-3 py-2 text-xs font-bold shadow"
        >
          <History className="size-3.5" /> Historique
        </button>
      </div>

      {/* Solde portefeuille + recharge (tap = page de recharge). */}
      <button
        type="button"
        onClick={() => router.push("/chauffeur/recharger")}
        className="mb-3 flex w-full items-center gap-3 rounded-[16px] border p-3.5 text-left"
        style={
          lowBalance
            ? {
                borderColor: "rgba(229,72,77,.25)",
                background: "rgba(229,72,77,.05)",
              }
            : { borderColor: "var(--d-line)", background: "var(--d-surface)" }
        }
      >
        <span
          className="grid size-10 shrink-0 place-items-center rounded-[12px]"
          style={{
            background: lowBalance ? "rgba(229,72,77,.12)" : "#F1E9FC",
            color: lowBalance ? RED : VIOLET,
          }}
        >
          <Wallet className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium text-[var(--d-muted)]">
            Solde portefeuille
          </span>
          <b
            className="drive-sora block text-[19px] leading-none tracking-[-0.5px]"
            style={{ color: lowBalance ? RED : "var(--d-ink)" }}
          >
            {balance == null ? "…" : formatDA(balance)}
          </b>
        </span>
        <span
          className="drive-sora flex shrink-0 items-center gap-1 rounded-full px-3.5 py-2 text-[12px] font-bold text-white"
          style={{ background: VIOLET }}
        >
          <Plus className="size-4" /> Recharger
        </span>
      </button>

      {/* BILAN COMBINÉ (compact) : aujourd'hui + ce mois dans une seule carte. */}
      <div className="rounded-[18px] border border-[var(--d-line)] bg-[var(--d-surface)] p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <b className="drive-sora text-sm">Ce mois ({month})</b>
          <span
            className="rounded-full px-2.5 py-1 text-[10px] font-extrabold text-white"
            style={{ background: VIOLET }}
          >
            {PLAN_LABEL[fin.plan] ?? "Gratuit"} · {fmtPct(fin.planRate)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-[14px] bg-[var(--d-soft)] px-3 py-2.5">
            <span className="block text-[10.5px] text-[var(--d-muted)]">
              Aujourd&apos;hui
            </span>
            <b className="drive-sora text-[18px]" style={{ color: GO }}>
              {formatDA(fin.todayNet)}
            </b>
            <span className="mt-0.5 block text-[10px] text-[var(--d-muted)]">
              {fin.todayRides} courses · {formatOnline(fin.todayOnlineMin)}
            </span>
          </div>
          <div className="rounded-[14px] bg-[var(--d-soft)] px-3 py-2.5">
            <span className="block text-[10.5px] text-[var(--d-muted)]">
              Net ce mois
            </span>
            <b className="drive-sora text-[18px]" style={{ color: GO }}>
              {formatDA(fin.monthNet)}
            </b>
            <span className="mt-0.5 block text-[10px] text-[var(--d-muted)]">
              {fin.monthRides} courses
            </span>
          </div>
        </div>

        {/* Détail seulement s'il y a une commission ou un abonnement à déduire
            (au lancement : 0 % → on n'encombre pas la carte). */}
        {(fin.planRate > 0 || fin.monthSubFee > 0) && (
          <div className="mt-1.5">
            <Line
              k={`Revenus bruts · ${fin.monthRides} courses`}
              v={formatDA(fin.monthGross)}
            />
            {fin.planRate > 0 && (
              <Line
                k={`Commission Coligo (${fmtPct(fin.planRate)})`}
                v={`−${formatDA(fin.monthCommission)}`}
                tone={RED}
              />
            )}
            {fin.monthSubFee > 0 && (
              <Line
                k="Abonnement mensuel"
                v={`−${formatDA(fin.monthSubFee)}`}
                tone={RED}
              />
            )}
          </div>
        )}
      </div>

      {/* À reverser — carte violette si dû, sinon pastille « à jour » (compact). */}
      {due > 0 ? (
        <div
          className="my-3 rounded-[18px] p-4 text-white"
          style={{ background: `linear-gradient(135deg,${VIOLET},#4B1FA6)` }}
        >
          <p className="text-xs opacity-85">À reverser à Coligo ce mois</p>
          <p className="drive-sora mt-1 text-[26px] font-extrabold">
            {formatDA(due)}
          </p>
          <p className="mt-1 text-[11px] opacity-90">{dueSub}</p>
        </div>
      ) : (
        <div
          className="my-3 flex items-center gap-2 rounded-[15px] bg-[var(--d-soft)] px-3.5 py-3 text-[12px] font-bold"
          style={{ color: GO }}
        >
          ✅ Rien à reverser ce mois — vous êtes à jour.
        </div>
      )}

      {/* Abonnement — ADAPTATIF : aucune référence à un plan inactif. */}
      <button
        type="button"
        onClick={() => router.push("/chauffeur/abonnement")}
        className="flex w-full items-center gap-2.5 rounded-[15px] border border-[var(--d-line)] p-3 text-left"
      >
        <PlanIcon plan={fin.plan} />
        <span className="min-w-0 flex-1">
          <b className="block text-[13.5px]">
            Abonnement : {PLAN_LABEL[fin.plan] ?? "Gratuit"}
          </b>
          <span className="text-[11px] text-[var(--d-muted)]">
            {fin.planRate <= 0
              ? "0 % de commission — vous gardez 100 % de vos gains 🎉"
              : "Voir les abonnements pour gagner en visibilité"}
          </span>
        </span>
        <span className="text-[var(--d-muted)]">›</span>
      </button>
    </div>
  );
}

function Line({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--d-line)] py-2.5 text-[13px] last:border-b-0">
      <span className="text-[var(--d-muted)]">{k}</span>
      <b className="drive-sora" style={tone ? { color: tone } : undefined}>
        {v}
      </b>
    </div>
  );
}

const HISTO_PAGE = 60;

/** Une ligne de course (réutilisée dans chaque mois de l'accordéon). */
function HistoRow({ r }: { r: ChauffeurHistoryRide }) {
  return (
    <div className="mb-2 flex items-center gap-3 rounded-[15px] border border-[var(--d-line)] p-3">
      <span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-[var(--d-soft)]">
        <Car className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[13.5px]">
          {r.customer_name} → {r.dest_text ?? "—"}
        </b>
        <small className="flex flex-wrap items-center gap-1 text-[11px] text-[var(--d-muted)]">
          {new Date(r.when).toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "short",
          })}{" "}
          {new Date(r.when).toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {r.completed ? (
            <>
              {" "}
              · {formatDA(r.price_da)}
              {r.net_da != null && <> · net +{formatDA(r.net_da)}</>}
              {r.gamme === "confort" && " · Confort"}
              {r.boosted && <Zap className="size-3" style={{ color: GO }} />}
            </>
          ) : (
            <>
              {" "}
              · annulée
              {r.cancelled_by === "customer" ? " par le client" : ""}
            </>
          )}
        </small>
      </span>
      <span
        className="shrink-0 rounded-full px-2 py-1 text-[10px] font-extrabold"
        style={
          r.completed
            ? { background: "rgba(22,179,100,.12)", color: GO }
            : { background: "rgba(229,72,77,.12)", color: RED }
        }
      >
        {r.completed ? "Terminée" : "Annulée"}
      </span>
    </div>
  );
}

/**
 * Historique des courses chauffeur — regroupé PAR MOIS, en accordéon. Les mois
 * sont pliés par défaut (peu consulté → page non encombrée) ; seul le mois le
 * plus récent est ouvert au chargement. Pagination « charger les mois
 * précédents » (par plage serveur) pour remonter aussi loin que voulu.
 */
export function DHisto() {
  const [rides, setRides] = useState<ChauffeurHistoryRide[] | null>(
    lastHistoCache
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const defaultedRef = useRef(false);

  useEffect(() => {
    void getChauffeurHistory(0, HISTO_PAGE).then((r) => {
      lastHistoCache = r;
      setRides(r);
      if (r.length < HISTO_PAGE) setAllLoaded(true);
    });
  }, []);

  // Regroupe par mois (clé année-mois), en conservant l'ordre décroissant.
  const months = useMemo(() => {
    const map = new Map<string, ChauffeurHistoryRide[]>();
    for (const r of rides ?? []) {
      const d = new Date(r.when);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const arr = map.get(key);
      if (arr) arr.push(r);
      else map.set(key, [r]);
    }
    return [...map.entries()];
  }, [rides]);

  // Ouvre le mois le plus récent par défaut (une seule fois).
  useEffect(() => {
    if (!defaultedRef.current && months.length > 0) {
      defaultedRef.current = true;
      setOpenMonths(new Set([months[0][0]]));
    }
  }, [months]);

  const toggle = (key: string) =>
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const loadMore = async () => {
    if (loadingMore || allLoaded || !rides) return;
    setLoadingMore(true);
    const next = await getChauffeurHistory(rides.length, HISTO_PAGE);
    const merged = [...rides, ...next];
    lastHistoCache = merged;
    setRides(merged);
    if (next.length < HISTO_PAGE) setAllLoaded(true);
    setLoadingMore(false);
  };

  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-5 pt-4 pb-24">
      <PartnerBackHeader title="Mes courses" />

      {rides == null ? (
        <div className="grid place-items-center py-12">
          <Loader2 className="size-6 animate-spin" style={{ color: VIOLET }} />
        </div>
      ) : rides.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--d-muted)]">
          Aucune course pour le moment.
        </p>
      ) : (
        <>
          {months.map(([key, items]) => {
            const d = new Date(items[0].when);
            const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
            const net = items.reduce(
              (s, r) => s + (r.completed && r.net_da != null ? r.net_da : 0),
              0
            );
            const open = openMonths.has(key);
            return (
              <div key={key} className="mb-2.5">
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  className="flex w-full items-center gap-2 rounded-[14px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <b className="drive-sora block text-[14px] capitalize">
                      {label}
                    </b>
                    <small className="text-[11px] text-[var(--d-muted)]">
                      {items.length} course{items.length > 1 ? "s" : ""} · net +
                      {formatDA(net)}
                    </small>
                  </span>
                  <ChevronDown
                    className="size-5 shrink-0 text-[var(--d-muted)] transition-transform"
                    style={{ transform: open ? "rotate(180deg)" : "none" }}
                  />
                </button>
                {open && (
                  <div className="mt-2">
                    {items.map((r) => (
                      <HistoRow key={r.id} r={r} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {!allLoaded && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] text-[13px] font-bold disabled:opacity-60"
            >
              {loadingMore ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Charger les mois précédents"
              )}
            </button>
          )}
        </>
      )}
    </div>
  );
}
