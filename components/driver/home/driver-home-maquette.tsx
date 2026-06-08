"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { setGlobalAvailability } from "@/app/(driver)/actions";
import { useDriverOnline, setDriverOnline } from "@/lib/driver/online-store";
import { playGo } from "@/lib/driver/sounds";

const ONLINE_SINCE_KEY = "coligo_driver_online_since";

function grp(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Accueil livreur (GO + réception) reproduit À L'IDENTIQUE de
 * MAQUETTE-livreur-uber / navigation : pastille gains, bouton GO rond
 * (violet→vert en ligne + 3 anneaux radar), son « mise en ligne », bottom sheet
 * (statut en ligne + barre de recherche animée + stats Courses/En ligne/Note).
 * Posé en overlay au-dessus de la vraie carte (MapLibre) ; la tabbar reste
 * persistante en dessous.
 */
export function DriverHomeMaquette({
  earnedToday,
  coursesToday,
  ratingAvg,
}: {
  earnedToday: number;
  coursesToday: number;
  ratingAvg: number;
}) {
  const online = useDriverOnline();
  const [busy, start] = useTransition();
  const router = useRouter();
  const [onlineLabel, setOnlineLabel] = useState("0h00");

  // Session « en ligne » (localStorage) → durée affichée dans les stats.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (online) {
      if (!localStorage.getItem(ONLINE_SINCE_KEY))
        localStorage.setItem(ONLINE_SINCE_KEY, String(Date.now()));
    } else {
      localStorage.removeItem(ONLINE_SINCE_KEY);
    }
  }, [online]);
  useEffect(() => {
    const tick = () => {
      const raw =
        typeof window !== "undefined"
          ? localStorage.getItem(ONLINE_SINCE_KEY)
          : null;
      if (!online || !raw) {
        setOnlineLabel("0h00");
        return;
      }
      const mins = Math.max(0, Math.floor((Date.now() - Number(raw)) / 60000));
      setOnlineLabel(
        `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`
      );
    };
    tick();
    const i = setInterval(tick, 30_000);
    return () => clearInterval(i);
  }, [online]);

  const toggle = () => {
    const next = !online;
    setDriverOnline(next);
    if (next) void playGo();
    toast.success(
      next ? "Tu es en ligne ⚡ Réception Express active" : "Tu es hors ligne"
    );
    start(async () => {
      await setGlobalAvailability(next ? "available" : "offline");
      router.refresh();
    });
  };

  return (
    <>
      {/* Pastille gains du jour. */}
      <div className="earn-pill">
        <div>
          <div className="e-t">Aujourd&apos;hui</div>
          <div className="e-v">{grp(earnedToday)} DA</div>
        </div>
        <div className="chev">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </div>
      </div>

      {/* Bouton GO. */}
      <div
        className={"go-wrap" + (online ? " online" : "")}
        style={{ bottom: 296 }}
      >
        <div style={{ position: "relative" }}>
          <div className="radar">
            <span />
            <span />
            <span />
          </div>
          <button
            type="button"
            className="go-btn"
            onClick={toggle}
            disabled={busy}
            aria-label={online ? "Passer hors ligne" : "Passer en ligne"}
          >
            <span className="go-off">GO</span>
            <span className="go-on">
              <span className="liv" />
              EN LIGNE
            </span>
          </button>
        </div>
        <div className="go-cap">Appuyez pour passer en ligne</div>
      </div>

      {/* Bottom sheet (au-dessus de la tabbar persistante). */}
      <div className="mq-sheet" style={{ bottom: 74 }}>
        <div className="grab" />
        <div className={"online-row" + (online ? " online" : "")}>
          <span className="dot" />
          <div className="ttl">
            <b>{online ? "Vous êtes en ligne" : "Vous êtes hors ligne"}</b>
            <span>
              {online
                ? "Prêt à livrer"
                : "Appuyez sur GO pour recevoir des courses"}
            </span>
          </div>
        </div>

        {online && (
          <div className="searchbar">
            <div className="lbl">
              <span className="sp" />
              Recherche d&apos;une commande à livrer…
            </div>
            <div className="track" />
          </div>
        )}

        <div className="stats">
          <div className="stat">
            <div className="sv">{coursesToday}</div>
            <div className="sl">Courses</div>
          </div>
          <div className="stat">
            <div className="sv">{onlineLabel}</div>
            <div className="sl">En ligne</div>
          </div>
          <div className="stat">
            <div className="sv">
              {ratingAvg ? ratingAvg.toFixed(1).replace(".", ",") : "—"}
              <small> ★</small>
            </div>
            <div className="sl">Note</div>
          </div>
        </div>
      </div>
    </>
  );
}
