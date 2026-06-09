"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setGlobalAvailability } from "@/app/(driver)/actions";
import { useDriverOnline, setDriverOnline } from "@/lib/driver/online-store";
import { playGo } from "@/lib/driver/sounds";

const ONLINE_SINCE_KEY = "coligo_driver_online_since";

export const FROZEN_MESSAGE =
  "Votre compte est gelé/bloqué. Merci de prendre contact avec le support pour résoudre le problème.";

function grp(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Accueil livreur (GO + réception) — version PRO « corrigée » reproduite À
 * L'IDENTIQUE de MAQUETTE-livreur-COMPLETE :
 *  - carte plein écran épurée (chip « ● En ligne » haut-gauche en ligne +
 *    bouton recentrer haut-droite porté par DriverHomeMap) ;
 *  - feuille basse = TÊTE D'INFORMATION : en-tête « Aujourd'hui » + montant du
 *    jour (raccourci vers Gains), 3 métriques EN LIGNE FINE (Courses · En
 *    ligne · Note), statut de recherche (en ligne) / invite (hors ligne) ;
 *  - bouton GO rond COMPACT en dock, à cheval sur le bord supérieur de la
 *    feuille : violet plein hors ligne (anneau interne + « GO »), vert plein +
 *    halo + vagues encerclées en ligne (« EN LIGNE ») ;
 *  - son « mise en ligne » (playGo), AUCUN toast de statut (le bouton + le chip
 *    suffisent).
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
  // Affiche le message « compte gelé » si le serveur refuse la mise en ligne.
  const [frozenMsg, setFrozenMsg] = useState(false);

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
    // AUCUN toast de statut : le bouton vert + le chip suffisent (cf. prompt).
    if (next) {
      // Passage en ligne : optimiste, mais le serveur peut refuser (gelé).
      setDriverOnline(true);
      start(async () => {
        const r = await setGlobalAvailability("available");
        if (r?.error === "FROZEN") {
          setDriverOnline(false); // on annule la mise en ligne
          setFrozenMsg(true); // et on réaffiche le message de blocage
          return;
        }
        void playGo();
        router.refresh();
      });
    } else {
      setDriverOnline(false);
      start(async () => {
        await setGlobalAvailability("offline");
        router.refresh();
      });
    }
  };

  return (
    <>
      {/* Message bloquant « compte gelé » (réaffiché à chaque clic sur GO). */}
      {frozenMsg && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-6"
          style={{ background: "rgba(8,9,16,.6)" }}
          onClick={() => setFrozenMsg(false)}
        >
          <div
            className="w-full max-w-sm text-center"
            style={{
              background: "var(--surface)",
              color: "var(--ink)",
              borderRadius: 22,
              padding: "26px 22px",
              boxShadow: "var(--pill-shadow)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: 56,
                height: 56,
                margin: "0 auto 14px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--red-soft)",
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ width: 28, height: 28, stroke: "var(--red)" }}
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
            </div>
            <h2
              className="mq-sora"
              style={{ fontSize: 19, fontWeight: 800, marginBottom: 8 }}
            >
              Compte gelé
            </h2>
            <p
              style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5 }}
            >
              {FROZEN_MESSAGE}
            </p>
            <button
              type="button"
              onClick={() => setFrozenMsg(false)}
              style={{
                marginTop: 18,
                width: "100%",
                height: 48,
                border: 0,
                borderRadius: 14,
                background: "var(--ink)",
                color: "var(--surface)",
                fontFamily: "var(--font-sora), Sora, sans-serif",
                fontWeight: 700,
                fontSize: 15,
              }}
            >
              J&apos;ai compris
            </button>
          </div>
        </div>
      )}

      {/* Chip discret « ● En ligne » (haut-gauche) — uniquement en ligne. */}
      {online && (
        <div className="home-chip">
          <span className="d" />
          En ligne
        </div>
      )}

      {/* Feuille d'accueil (tête d'information), posée au-dessus de la tabbar.
          La classe `online` pilote le bouton (vert + radar), le statut de
          recherche et la couleur du bouton via le CSS de la maquette. */}
      <div className={"mq-sheet" + (online ? " online" : "")}>
        {/* Bouton GO en dock (à cheval sur le bord supérieur de la feuille). */}
        <div className="go-cap">
          {online
            ? "Appuyez pour vous déconnecter"
            : "Appuyez pour passer en ligne"}
        </div>
        <div className="go-dock">
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
            <span className="go-on">EN LIGNE</span>
          </button>
        </div>

        {/* Ligne 1 — « Aujourd'hui » + montant du jour (raccourci vers Gains). */}
        <Link
          href="/driver/gains"
          className="home-head"
          aria-label="Voir mes gains"
        >
          <div>
            <div className="lbl">Aujourd&apos;hui</div>
            <div className="v">{grp(earnedToday)} DA</div>
          </div>
          <div className="gchev">
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
        </Link>

        {/* Ligne 2 — 3 métriques EN LIGNE FINE dans un seul bloc --soft. */}
        <div className="metrics">
          <div className="m">
            <div className="mv">{coursesToday}</div>
            <div className="ml">Courses</div>
          </div>
          <div className="sep" />
          <div className="m">
            <div className="mv">{onlineLabel}</div>
            <div className="ml">En ligne</div>
          </div>
          <div className="sep" />
          <div className="m">
            <div className="mv">
              {ratingAvg ? ratingAvg.toFixed(1).replace(".", ",") : "—"}
              <small> ★</small>
            </div>
            <div className="ml">Note</div>
          </div>
        </div>

        {/* En ligne : statut de recherche (libellé + barre de balayage). */}
        <div className="statusline">
          <div className="lbl">
            <span className="sp" />
            Recherche d&apos;une commande à livrer…
          </div>
          <div className="track" />
        </div>

        {/* Hors ligne : simple ligne d'invite. */}
        <div className="offhint">
          Passez en ligne pour recevoir des commandes
        </div>
      </div>
    </>
  );
}
