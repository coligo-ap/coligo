"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SRC = "/alert.wav";

export type PlayOptions = {
  /** Rejoue le son en boucle jusqu'à `stop()`. Par défaut : false. */
  repeat?: boolean;
  /** Délai entre 2 lectures successives en mode `repeat`. Défaut 1500 ms. */
  intervalMs?: number;
};

/**
 * Son d'alerte pour les nouvelles commandes.
 *
 * Workaround autoplay : la plupart des navigateurs bloquent toute lecture
 * audio tant qu'aucun geste utilisateur n'a eu lieu sur la page. `unlock()`
 * joue le fichier en muet sous l'effet d'un clic, ce qui débloque les
 * lectures futures non mutées.
 *
 * Mode comptoir : `play({ repeat: true })` rejoue en boucle jusqu'à `stop()`
 * — pour que le commerçant ne rate pas une commande même s'il regarde
 * ailleurs.
 */
export function useAlertSound() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const repeatRef = useRef<{
    on: boolean;
    intervalMs: number;
    timer: number | null;
  }>({
    on: false,
    intervalMs: 1500,
    timer: null,
  });
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const a = new Audio(SRC);
    a.preload = "auto";
    a.volume = 0.9;
    audioRef.current = a;

    // `state` est l'objet pointé par le ref — il reste le même tant que le
    // hook est monté, donc on peut le capturer ici pour le cleanup.
    const state = repeatRef.current;

    const onEnded = () => {
      if (!state.on) return;
      state.timer = window.setTimeout(() => {
        const audio = audioRef.current;
        if (audio && state.on) {
          audio.currentTime = 0;
          void audio.play().catch(() => {
            /* perdu pour celle-ci, mais on garde le mode actif */
          });
        }
      }, state.intervalMs);
    };
    a.addEventListener("ended", onEnded);

    return () => {
      a.removeEventListener("ended", onEnded);
      a.pause();
      if (state.timer != null) {
        window.clearTimeout(state.timer);
        state.timer = null;
      }
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

  const play = useCallback(
    async ({
      repeat = false,
      intervalMs = 1500,
    }: PlayOptions = {}): Promise<boolean> => {
      const a = audioRef.current;
      if (!a) return false;
      repeatRef.current.on = repeat;
      repeatRef.current.intervalMs = intervalMs;
      try {
        a.currentTime = 0;
        await a.play();
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  const stop = useCallback(() => {
    repeatRef.current.on = false;
    if (repeatRef.current.timer != null) {
      window.clearTimeout(repeatRef.current.timer);
      repeatRef.current.timer = null;
    }
    const a = audioRef.current;
    if (a) {
      try {
        a.pause();
        a.currentTime = 0;
      } catch {
        /* ignoré */
      }
    }
  }, []);

  return { play, stop, unlock, unlocked };
}

/**
 * Vibration brève (sans bloc) — no-op sur iOS qui ne supporte pas la
 * Vibration API. On essaie quand même : Android renvoie `true`, iOS `false`.
 */
export function vibrate(pattern: number | number[] = [200, 100, 200]): boolean {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.vibrate !== "function"
  ) {
    return false;
  }
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}
