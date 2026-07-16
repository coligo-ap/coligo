"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { CalendarDays, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { onVisibleResumeSafe } from "@/lib/net/probe";
import { fetchDriverTourCounts } from "@/app/(driver)/actions";
import { playNewOrder } from "@/lib/driver/sounds";
import { vibrate } from "@/lib/hooks/use-alert-sound";

/**
 * Dispatch TOURNÉE (notification temps réel), monté GLOBALEMENT dans le layout
 * livreur → s'affiche sur n'importe quel écran. Ne fait PAS d'attribution
 * automatique (≠ Express) : une tournée est liée à un créneau d'un commerçant
 * où le livreur est inscrit. Quand une NOUVELLE commande en tournée arrive chez
 * l'un de ses commerçants, un bandeau « 📅 Nouvelle tournée » apparaît (badge
 * tournée distinct de l'Express ⚡), avec son léger, cliquable → ouvre la
 * tournée du commerçant.
 *
 * Mécanisme : poll de l'RPC `driver_delivery_counts` (SECURITY DEFINER, sûr) +
 * Realtime best-effort sur les commandes `delivery_mode=tour` (re-poll immédiat
 * si autorisé par RLS, sinon le poll couvre). On n'alerte que sur une
 * AUGMENTATION du compteur par rapport au dernier instantané (pas sur l'existant
 * au lancement). Pause quand l'onglet est masqué (batterie).
 */
type TourAlert = { mdId: string; merchantName: string; count: number };

export function TourDispatchMount() {
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  // null = instantané pas encore pris (on n'alerte pas au tout premier tick).
  const snapshot = useRef<Map<string, number> | null>(null);
  const [alert, setAlert] = useState<TourAlert | null>(null);
  const tickRef = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const rows = await fetchDriverTourCounts();
      if (!alive) return;
      const next = new Map(rows.map((r) => [r.mdId, r.tourPending]));
      const prev = snapshot.current;
      if (prev) {
        for (const r of rows) {
          if (r.tourPending > (prev.get(r.mdId) ?? 0)) {
            setAlert({
              mdId: r.mdId,
              merchantName: r.merchantName,
              count: r.tourPending,
            });
            void playNewOrder();
            vibrate([0, 80, 40, 80]);
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(() => {
              if (alive) setAlert(null);
            }, 15_000);
            break;
          }
        }
      }
      snapshot.current = next;
    };
    tickRef.current = tick;

    void tick();
    const poll = setInterval(tick, 30_000);
    // Retour au premier plan SONDÉ (anti requête fantôme sur socket mort).
    const offVisible = onVisibleResumeSafe(() => void tickRef.current());

    // Realtime best-effort : toute commande en tournée → re-poll immédiat.
    const supabase = createClient();
    const channel = supabase
      .channel("driver-tour-dispatch")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "orders",
          filter: "delivery_mode=eq.tour",
        },
        () => void tickRef.current()
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: "delivery_mode=eq.tour",
        },
        () => void tickRef.current()
      )
      .subscribe();

    return () => {
      alive = false;
      clearInterval(poll);
      if (hideTimer) clearTimeout(hideTimer);
      offVisible();
      void supabase.removeChannel(channel);
    };
  }, []);

  if (!alert) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[80] flex justify-center px-3 pt-[calc(12px+env(safe-area-inset-top))]">
      <div className="partner-sheet-in flex w-full max-w-md items-center gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-3 shadow-xl">
        <button
          type="button"
          onClick={() => {
            router.push(`/driver/m/${alert.mdId}/tours`);
            setAlert(null);
          }}
          className="flex min-w-0 flex-1 items-center gap-3 text-start"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-[13px] bg-[var(--violet-soft)] text-[var(--violet)]">
            <CalendarDays className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="mb-1 inline-block rounded-full bg-[var(--violet)] px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-white uppercase">
              📅 {tr("Tournée", "جولة")}
            </span>
            <span className="block truncate text-sm font-bold text-[var(--ink)]">
              {tr("Nouvelle tournée", "جولة جديدة")} · {alert.merchantName}
            </span>
            <span className="block text-xs font-medium text-[var(--muted)]">
              {alert.count}{" "}
              {isAr
                ? "طلبية في الجولة · اضغط للعرض"
                : `commande${alert.count > 1 ? "s" : ""} en tournée · appuyez pour voir`}
            </span>
          </span>
        </button>
        <button
          type="button"
          aria-label={tr("Fermer", "إغلاق")}
          onClick={() => setAlert(null)}
          className="grid size-8 shrink-0 place-items-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--soft)]"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
