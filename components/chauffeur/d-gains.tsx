"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { Car, ChevronDown, Loader2, Zap } from "lucide-react";
import { formatDA } from "@/lib/utils";
import { MoneyTabs } from "@/components/shared/money-tabs";
import { VIOLET, GO, RED } from "@/components/customer/drive/drive-modals";
import { registerChauffeurCacheReset } from "@/lib/chauffeur/client-cache";
import {
  getChauffeurHistory,
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

const MONTHS_AR = [
  "جانفي",
  "فيفري",
  "مارس",
  "أفريل",
  "ماي",
  "جوان",
  "جويلية",
  "أوت",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

// Cache module (SWR) : au RETOUR sur l'Historique, on réaffiche la dernière
// donnée INSTANTANÉMENT (plus de spinner plein écran), le refetch se fait en
// arrière-plan. Évite de re-bloquer la page à chaque navigation.
// (Le volet Gains vit désormais dans la page serveur « Gains et Relevés ».)
let lastHistoCache: ChauffeurHistoryRide[] | null = null;
// Vidange au changement de compte (anti-fuite sur appareil partagé).
registerChauffeurCacheReset(() => {
  lastHistoCache = null;
});

const HISTO_PAGE = 60;

/** Une ligne de course (réutilisée dans chaque mois de l'accordéon). */
function HistoRow({ r }: { r: ChauffeurHistoryRide }) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  return (
    <div className="rounded-card-xl mb-2 flex items-center gap-3 border border-[var(--d-line)] p-3">
      <span className="rounded-control-lg grid size-[34px] shrink-0 place-items-center bg-[var(--d-soft)]">
        <Car className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <b className="text-body block truncate">
          {r.customer_name} → {r.dest_text ?? "—"}
        </b>
        <small className="text-caption flex flex-wrap items-center gap-1 text-[var(--d-muted)]">
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
              {r.net_da != null && (
                <>
                  {" "}
                  · {tr("net", "صافي")} +{formatDA(r.net_da)}
                </>
              )}
              {r.tip_da > 0 && (
                <span className="font-bold" style={{ color: GO }}>
                  · {tr("pourboire", "إكرامية")} +{r.tip_da}
                </span>
              )}
              {r.gamme === "confort" && ` · ${tr("Confort", "كونفور")}`}
              {r.boosted && <Zap className="size-3" style={{ color: GO }} />}
            </>
          ) : (
            <>
              {" "}
              · {tr("annulée", "أُلغيت")}
              {r.cancelled_by === "customer"
                ? tr(" par le client", " من طرف الزبون")
                : ""}
            </>
          )}
        </small>
      </span>
      <span
        className="text-micro shrink-0 rounded-full px-2 py-1 font-extrabold"
        style={
          r.completed
            ? { background: "rgba(22,179,100,.12)", color: GO }
            : { background: "rgba(229,72,77,.12)", color: RED }
        }
      >
        {r.completed ? tr("Terminée", "مكتملة") : tr("Annulée", "ملغاة")}
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
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
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
    <div className="drive-jakarta drive-page pb-safe-nav min-h-screen bg-[var(--d-surface)] px-5">
      {/* Hub Argent : Gains · Courses · Coligo Pay — HÉRO thémé (le bandeau
          gère lui-même la safe-area, d'où l'absence de pt-safe ici). */}
      <MoneyTabs base="/chauffeur" heroTitle={tr("Courses", "التوصيلات")} />

      {rides == null ? (
        <div className="grid place-items-center py-12">
          <Loader2 className="size-6 animate-spin" style={{ color: VIOLET }} />
        </div>
      ) : rides.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--d-muted)]">
          {tr("Aucune course pour le moment.", "لا مشاوير حتى الآن.")}
        </p>
      ) : (
        <>
          {months.map(([key, items]) => {
            const d = new Date(items[0].when);
            const label = `${(isAr ? MONTHS_AR : MONTHS)[d.getMonth()]} ${d.getFullYear()}`;
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
                  className="rounded-card-lg flex w-full items-center gap-2 border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-start"
                >
                  <span className="min-w-0 flex-1">
                    <b className="drive-sora text-body-lg block capitalize">
                      {label}
                    </b>
                    <small className="text-caption text-[var(--d-muted)]">
                      {items.length}{" "}
                      {isAr ? "مشوار" : `course${items.length > 1 ? "s" : ""}`}{" "}
                      · {tr("net", "صافي")} +{formatDA(net)}
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
              className="rounded-card-lg text-body-sm mt-2 flex h-12 w-full items-center justify-center gap-2 border border-[var(--d-line)] bg-[var(--d-surface)] font-bold disabled:opacity-60"
            >
              {loadingMore ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                tr("Charger les mois précédents", "تحميل الأشهر السابقة")
              )}
            </button>
          )}
        </>
      )}
    </div>
  );
}
