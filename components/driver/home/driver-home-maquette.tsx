"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setGlobalAvailability } from "@/app/(driver)/actions";
import { useDriverOnline, setDriverOnline } from "@/lib/driver/online-store";
import { DriverBalancePill } from "@/components/driver/balance-pill";
import { DriverDarkPill } from "@/components/driver/driver-dark-pill";
import { playGo } from "@/lib/driver/sounds";

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
  driverId,
  earnedToday,
  coursesToday,
  isFrozen = false,
  freezeReason = null,
}: {
  driverId: string;
  earnedToday: number;
  coursesToday: number;
  isFrozen?: boolean;
  freezeReason?: string | null;
}) {
  const online = useDriverOnline();
  const [, start] = useTransition();
  const router = useRouter();
  // Affiche le message « compte gelé » si le serveur refuse la mise en ligne.
  const [frozenMsg, setFrozenMsg] = useState(false);

  const toggle = () => {
    const next = !online;
    // Compte gelé : refus immédiat de la mise en ligne (le passage HORS LIGNE
    // reste toujours permis).
    if (next && isFrozen) {
      setFrozenMsg(true);
      return;
    }
    // Bascule OPTIMISTE et INSTANTANÉE dans les deux sens : le store est la
    // source de vérité du bouton (et du dispatch). La synchro serveur
    // (lente : boucle sur chaque paire commerçant) part en arrière-plan et NE
    // bloque PAS le bouton — qui n'est donc jamais désactivé. Plus de
    // router.refresh() bloquant : passer hors ligne est aussi rapide que
    // passer en ligne.
    setDriverOnline(next);
    if (next) void playGo();
    start(async () => {
      const r = await setGlobalAvailability(next ? "available" : "offline");
      // Le serveur a refusé la mise en ligne (gelé entre-temps) → on annule.
      if (next && r?.error === "FROZEN") {
        setDriverOnline(false);
        setFrozenMsg(true);
        return;
      }
      // Rafraîchit les données serveur (compteurs…) seulement à la mise en
      // ligne, en arrière-plan — inutile et coûteux au passage hors ligne.
      if (next) router.refresh();
    });
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
            {freezeReason && (
              <p
                style={{
                  fontSize: 12.5,
                  color: "var(--muted)",
                  marginTop: 8,
                }}
              >
                Motif : {freezeReason}
              </p>
            )}
            <button
              type="button"
              onClick={() => setFrozenMsg(false)}
              style={{
                marginTop: 18,
                width: "100%",
                height: 48,
                border: 0,
                borderRadius: 14,
                background: "var(--violet)",
                color: "#fff",
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

      {/* Bandeau « compte gelé » (souple) : accès aux pages OK, activité bloquée. */}
      {isFrozen && (
        <button
          type="button"
          onClick={() => setFrozenMsg(true)}
          className="mq-sora"
          style={{
            position: "absolute",
            top: "max(58px, calc(env(safe-area-inset-top) + 14px))",
            left: 16,
            right: 16,
            zIndex: 46,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--red)",
            color: "#fff",
            border: 0,
            borderRadius: 14,
            padding: "10px 14px",
            fontSize: 12.5,
            fontWeight: 700,
            boxShadow: "var(--pill-shadow)",
            textAlign: "left",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: 18, height: 18, stroke: "#fff", flex: "none" }}
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          Compte gelé · activité suspendue — appuyez pour en savoir plus
        </button>
      )}

      {/* Barre du haut alignée : statut « ● En ligne » (gauche, en ligne
          seulement) ⟷ solde portefeuille (droite, → page de recharge). */}
      <div className="home-topbar">
        {online && !isFrozen ? (
          <div className="home-chip">
            <span className="d" />
            En ligne
          </div>
        ) : (
          <span aria-hidden />
        )}
        <div className="flex items-center gap-2">
          <DriverDarkPill />
          <DriverBalancePill driverId={driverId} />
        </div>
      </div>

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
            aria-label={online ? "Se déconnecter" : "Passer en ligne"}
          >
            <span className="go-off">GO</span>
            <span className="go-on">EN LIGNE</span>
          </button>
        </div>

        {/* Hero du jour : gains + nombre de courses (raccourci vers Gains).
            La note et le temps en ligne ne sont PLUS sur l'accueil (la note est
            réservée au profil). */}
        <Link
          href="/driver/gains"
          className="home-head"
          aria-label="Voir mes gains"
        >
          <div className="hh-main">
            <div className="lbl">Aujourd&apos;hui</div>
            <div className="v">{grp(earnedToday)} DA</div>
          </div>
          <div className="hh-stat">
            <div className="hh-num">{coursesToday}</div>
            <div className="lbl">course{coursesToday > 1 ? "s" : ""}</div>
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
