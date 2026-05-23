"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SRC = "/alert.wav";

/**
 * Son d'alerte pour les nouvelles commandes.
 *
 * Workaround autoplay : la plupart des navigateurs bloquent toute lecture
 * audio tant qu'aucun geste utilisateur n'a eu lieu sur la page. `unlock()`
 * joue le fichier en muet sous l'effet d'un clic, ce qui débloque les
 * lectures futures non mutées.
 */
export function useAlertSound() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const a = new Audio(SRC);
    a.preload = "auto";
    a.volume = 0.9;
    audioRef.current = a;
    return () => {
      a.pause();
      audioRef.current = null;
    };
  }, []);

  const unlock = useCallback(async (): Promise<boolean> => {
    const a = audioRef.current;
    if (!a) return false;
    const wasMuted = a.muted;
    a.muted = true;
    try {
      await a.play();
      a.pause();
      a.currentTime = 0;
      a.muted = wasMuted;
      setUnlocked(true);
      return true;
    } catch {
      a.muted = wasMuted;
      return false;
    }
  }, []);

  const play = useCallback(async (): Promise<boolean> => {
    const a = audioRef.current;
    if (!a) return false;
    try {
      a.currentTime = 0;
      await a.play();
      return true;
    } catch {
      // Pas encore débloqué : signal renvoyé pour que l'UI propose le bouton.
      return false;
    }
  }, []);

  return { play, unlock, unlocked };
}
