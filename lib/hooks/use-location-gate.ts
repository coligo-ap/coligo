"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getPosition,
  geolocationSupported,
  readGeoPermission,
  requestGeoPermission,
  onGeoPermissionChange,
  type Coords,
} from "@/lib/native";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";

// =============================================================================
// useLocationGate — la localisation est OBLIGATOIRE pour travailler.
// =============================================================================
// Utilisé par les espaces CHAUFFEUR et LIVREUR : sans position exacte, la
// plateforme ne peut ni les placer sur la carte, ni leur envoyer une course, ni
// prouver un trajet. Le hook dit à l'écran s'il doit bloquer, et pourquoi.
//
// Quatre issues :
//   - "checking"  : première résolution en cours → on ne bloque PAS (pas de
//                   flash d'écran rouge à chaque démarrage).
//   - "ok"        : permission accordée ET un point réel obtenu.
//   - "prompt"    : jamais demandée → le bouton déclenche le dialogue système.
//   - "denied"    : refusée. L'OS ne réaffichera plus rien (« Ne plus
//                   demander ») → seul chemin restant : les réglages du
//                   téléphone.
//   - "off"       : autorisée, mais AUCUN point ne revient — le service de
//                   localisation du téléphone est éteint, ou le GPS ne capte
//                   rien du tout.
//
// GRÂCE sur "off" : un tunnel, un parking souterrain ou un fix lent ne doivent
// PAS jeter un chauffeur en course hors de son écran. On ne bascule sur "off"
// qu'après GRACE_FAILURES tentatives infructueuses espacées de RETRY_MS — et
// on ressort tout seul dès qu'un point arrive. Un REFUS de permission, lui, est
// immédiat : il n'a rien d'accidentel.
//
// Re-vérification : à la reprise au premier plan (retour depuis les réglages du
// téléphone — en natif, AUCUN événement ne le signale), au changement de
// permission (web), et par un battement léger qui ne lit QUE la permission
// (aucun réveil du GPS, donc aucun coût batterie).
// =============================================================================

export type LocationGateStatus =
  | "checking"
  | "ok"
  | "prompt"
  | "denied"
  | "off"
  | "unsupported";

/** Tentatives infructueuses avant de considérer la localisation éteinte. */
const GRACE_FAILURES = 3;
/** Intervalle entre deux tentatives de fix quand on n'en a pas. */
const RETRY_MS = 15_000;
/** Battement de relecture de la PERMISSION seule (pas de GPS). */
const PERMISSION_POLL_MS = 20_000;

export type LocationGate = {
  status: LocationGateStatus;
  /** Dernier point connu (null tant qu'aucun fix n'est arrivé). */
  coords: Coords | null;
  /** Vrai pendant une demande d'autorisation / une tentative de fix. */
  busy: boolean;
  /** Déclenche le dialogue système puis retente un fix. */
  request: () => Promise<void>;
  /** Relit permission + position (au retour des réglages, par exemple). */
  recheck: () => Promise<void>;
};

export function useLocationGate(): LocationGate {
  const [status, setStatus] = useState<LocationGateStatus>("checking");
  const [coords, setCoords] = useState<Coords | null>(null);
  const [busy, setBusy] = useState(false);

  // Compteur d'échecs consécutifs de fix (permission accordée) → grâce.
  const failuresRef = useRef(0);
  // Un seul passage à la fois : les déclencheurs (montage, reprise, battement,
  // bouton) peuvent se chevaucher.
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const evaluate = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      if (!geolocationSupported()) {
        if (mountedRef.current) setStatus("unsupported");
        return;
      }

      const perm = await readGeoPermission();
      if (!mountedRef.current) return;

      if (perm === "denied") {
        failuresRef.current = 0;
        setStatus("denied");
        return;
      }
      // "unknown" (Safari ancien) : on ne peut trancher qu'en tentant un fix —
      // un refus se traduira par l'échec ci-dessous.
      if (perm === "prompt") {
        failuresRef.current = 0;
        setStatus("prompt");
        return;
      }

      // Permission accordée (ou indéterminable) → il faut un VRAI point.
      try {
        const c = await getPosition({
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 30_000,
        });
        if (!mountedRef.current) return;
        failuresRef.current = 0;
        setCoords(c);
        setStatus("ok");
      } catch (err) {
        if (!mountedRef.current) return;
        // Un refus révélé à ce moment-là (Safari « unknown ») est définitif.
        const kind = (err as { kind?: string })?.kind;
        if (kind === "denied") {
          failuresRef.current = 0;
          setStatus("denied");
          return;
        }
        failuresRef.current += 1;
        // Sous le seuil de grâce : on NE bloque pas encore. Si on n'avait
        // jamais rien résolu, on reste en "checking" (démarrage) ; si on était
        // déjà "ok", on garde "ok" (le watch de l'app a peut-être un point).
        if (failuresRef.current < GRACE_FAILURES) return;
        setStatus("off");
      }
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const request = useCallback(async () => {
    setBusy(true);
    try {
      const perm = await requestGeoPermission();
      if (!mountedRef.current) return;
      if (perm === "denied") {
        setStatus("denied");
        return;
      }
      failuresRef.current = 0;
      await evaluate();
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [evaluate]);

  const recheck = useCallback(async () => {
    setBusy(true);
    try {
      failuresRef.current = 0;
      await evaluate();
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [evaluate]);

  // Première résolution au montage.
  useEffect(() => {
    void evaluate();
  }, [evaluate]);

  // Retour au premier plan : c'est LE moment où l'on découvre que le chauffeur
  // vient d'accorder la permission dans les réglages du téléphone.
  useResumeResync(() => {
    failuresRef.current = 0;
    void evaluate();
  });

  // Web : la permission peut changer sans quitter la page (réglages du site).
  useEffect(() => onGeoPermissionChange(() => void evaluate()), [evaluate]);

  // Battements : relance rapide tant qu'on n'a pas de point (le chauffeur sort
  // d'un tunnel), lecture de permission seule ensuite (aucun réveil du GPS).
  useEffect(() => {
    const blocked = status !== "ok";
    const period = blocked ? RETRY_MS : PERMISSION_POLL_MS;
    const id = setInterval(() => void evaluate(), period);
    return () => clearInterval(id);
  }, [status, evaluate]);

  return { status, coords, busy, request, recheck };
}

/** Le statut interdit-il de travailler ? (`checking` ne bloque jamais.) */
export function gateBlocks(status: LocationGateStatus): boolean {
  return status === "denied" || status === "prompt" || status === "off";
}
