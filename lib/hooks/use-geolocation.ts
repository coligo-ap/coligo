"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GeolocationError,
  getPosition,
  watchPosition,
  type Coords,
  type WatchHandle,
} from "@/lib/native";

type State = {
  coords: Coords | null;
  error: GeolocationError | null;
  loading: boolean;
  watching: boolean;
};

/**
 * Hook géoloc — clean-up auto au unmount, coupe le watch en cas de refus.
 */
export function useGeolocation() {
  const [state, setState] = useState<State>({
    coords: null,
    error: null,
    loading: false,
    watching: false,
  });
  const watchRef = useRef<WatchHandle | null>(null);

  const stopWatch = useCallback(() => {
    watchRef.current?.stop();
    watchRef.current = null;
    setState((s) => ({ ...s, watching: false }));
  }, []);

  const requestOnce = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const coords = await getPosition();
      setState((s) => ({ ...s, coords, loading: false }));
      return coords;
    } catch (err) {
      const geoErr =
        err instanceof GeolocationError
          ? err
          : new GeolocationError("unknown", String(err));
      setState((s) => ({ ...s, error: geoErr, loading: false }));
      return null;
    }
  }, []);

  const startWatch = useCallback(() => {
    if (watchRef.current) return;
    setState((s) => ({ ...s, error: null, watching: true }));
    const handle = watchPosition(
      (coords) => setState((s) => ({ ...s, coords, error: null })),
      (err) => {
        setState((s) => ({ ...s, error: err }));
        // Sur refus explicite, inutile de garder le watch actif.
        if (err.kind === "denied") {
          watchRef.current?.stop();
          watchRef.current = null;
          setState((s) => ({ ...s, watching: false }));
        }
      }
    );
    watchRef.current = handle;
    if (!handle) setState((s) => ({ ...s, watching: false }));
  }, []);

  useEffect(() => {
    return () => {
      watchRef.current?.stop();
      watchRef.current = null;
    };
  }, []);

  return {
    ...state,
    requestOnce,
    startWatch,
    stopWatch,
  };
}
