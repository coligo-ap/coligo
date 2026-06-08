"use client";

import { useSyncExternalStore } from "react";

/**
 * Course active du livreur — source de vérité unique, persistée en localStorage
 * et partagée dans toute l'app livreur (sans context). Permet le pattern de
 * navigation des maquettes : pendant une course, on peut RÉDUIRE la navigation
 * plein écran (→ on revient sur un onglet) ; un bandeau « Course en cours »
 * épinglé au-dessus de la tabbar reste affiché sur n'importe quel onglet et
 * permet de RÉ-AGRANDIR la navigation d'un tap (cf. MAQUETTE-livreur-navigation).
 *
 * `step` distingue retrait (pickup) et livraison (dropoff) pour le sous-titre.
 */
export type ActiveCourse = {
  orderId: string;
  merchantName: string;
  step: "pickup" | "dropoff";
} | null;

const KEY = "coligo_active_course";

let state: ActiveCourse | undefined; // undefined = pas encore lu depuis localStorage
const listeners = new Set<() => void>();

function read(): ActiveCourse {
  if (typeof window === "undefined") return null;
  if (state === undefined) {
    try {
      const raw = localStorage.getItem(KEY);
      state = raw ? (JSON.parse(raw) as ActiveCourse) : null;
    } catch {
      state = null;
    }
  }
  return state ?? null;
}

function emit() {
  for (const l of listeners) l();
}

export function getActiveCourse(): ActiveCourse {
  return read();
}

export function setActiveCourse(next: NonNullable<ActiveCourse>) {
  const cur = read();
  if (
    cur &&
    cur.orderId === next.orderId &&
    cur.step === next.step &&
    cur.merchantName === next.merchantName
  ) {
    return; // inchangé → pas de re-render
  }
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* localStorage indispo → état en mémoire */
  }
  emit();
}

export function clearActiveCourse() {
  if (read() === null) return;
  state = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
}

export function useActiveCourse(): ActiveCourse {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(),
    () => null
  );
}
