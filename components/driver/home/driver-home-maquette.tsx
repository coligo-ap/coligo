"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { setGlobalAvailability } from "@/app/(driver)/actions";
import { useDriverOnline, setDriverOnline } from "@/lib/driver/online-store";
import { playGo } from "@/lib/driver/sounds";

const ONLINE_SINCE_KEY = "coligo_driver_online_since";

export type TodayDelivery = {
  id: string;
  merchantName: string;
  address: string | null;
  at: string | null;
  gain: number;
  paymentMethod: "cash" | "online";
};

function grp(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
function hhmm(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Algiers",
  });
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
  todayDeliveries,
}: {
  earnedToday: number;
  coursesToday: number;
  ratingAvg: number;
  todayDeliveries: TodayDelivery[];
}) {
  const online = useDriverOnline();
  const [busy, start] = useTransition();
  const router = useRouter();
  const [onlineLabel, setOnlineLabel] = useState("0h00");
  const [showToday, setShowToday] = useState(false);

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
      {/* Pastille gains du jour — tap → mini-historique du jour. */}
      <button
        type="button"
        className="earn-pill"
        onClick={() => setShowToday(true)}
        aria-label="Voir les courses d'aujourd'hui"
      >
        <div>
          <div className="e-t">Aujourd&apos;hui · {coursesToday}</div>
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
      </button>

      {/* Feuille « Aujourd'hui » : courses du jour uniquement + lien Historique. */}
      {showToday && (
        <div
          className="fixed inset-0 z-[80] flex items-end"
          style={{ background: "rgba(8,9,16,.45)" }}
          onClick={() => setShowToday(false)}
        >
          <div
            className="mx-auto w-full max-w-md"
            style={{
              background: "var(--surface)",
              borderRadius: "24px 24px 0 0",
              padding: "14px 18px max(20px,env(safe-area-inset-bottom))",
              maxHeight: "78vh",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grab" />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                margin: "2px 2px 14px",
              }}
            >
              <h2
                className="mq-sora"
                style={{
                  fontSize: 19,
                  fontWeight: 800,
                  letterSpacing: "-0.4px",
                }}
              >
                Aujourd&apos;hui · {coursesToday} course
                {coursesToday > 1 ? "s" : ""}
              </h2>
              <b
                className="mq-sora"
                style={{ fontSize: 18, color: "var(--go)" }}
              >
                +{grp(earnedToday)} DA
              </b>
            </div>

            {todayDeliveries.length === 0 ? (
              <p
                style={{
                  color: "var(--muted)",
                  fontSize: 13,
                  padding: "8px 2px 16px",
                }}
              >
                Aucune course livrée aujourd&apos;hui pour le moment.
              </p>
            ) : (
              todayDeliveries.map((d) => (
                <div className="hcard" key={d.id}>
                  <div className="rail">
                    <span className="d s" />
                    <span className="ln" />
                    <span className="d e" />
                  </div>
                  <div className="mid">
                    <div className="nm">{d.merchantName}</div>
                    <div className="nm">{d.address ?? "Adresse client"}</div>
                    <div className="meta">
                      <span>{hhmm(d.at)}</span>·
                      <span className="tg">
                        {d.paymentMethod === "cash" ? "Espèces" : "Prépayé"}
                      </span>
                    </div>
                  </div>
                  <div className="right">
                    <span className="amt">+{grp(d.gain)} DA</span>
                    <span className="badge ok">Livrée</span>
                  </div>
                </div>
              ))
            )}

            <Link
              href="/driver/historique"
              className="linkcard"
              style={{ marginTop: 8 }}
            >
              <div className="ic">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </div>
              <div className="t">
                <b>Voir tout l&apos;historique</b>
                <span>Toutes les courses, filtres et jours précédents</span>
              </div>
              <svg
                className="chev"
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </Link>
          </div>
        </div>
      )}

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
            aria-label={online ? "Se déconnecter" : "Passer en ligne"}
          >
            <span className="go-off">GO</span>
            <span className="go-on">
              <span className="liv" />
              EN LIGNE
            </span>
          </button>
        </div>
        {/* Légende = unique source de statut + comment se déconnecter (pas de
            doublon « Vous êtes en ligne / Prêt à livrer »). */}
        <div className="go-cap" style={{ display: "inline-block" }}>
          {online
            ? "Appuyez pour vous déconnecter"
            : "Appuyez pour passer en ligne"}
        </div>
      </div>

      {/* Bottom sheet (au-dessus de la tabbar persistante) — sans répéter le
          statut : juste la recherche animée (en ligne) + les stats. */}
      <div className="mq-sheet" style={{ bottom: 74 }}>
        <div className="grab" />

        {online && (
          <div className="searchbar" style={{ marginTop: 2, marginBottom: 16 }}>
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
