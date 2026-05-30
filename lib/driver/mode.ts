"use client";

/**
 * Préférence locale du livreur : quel(s) mode(s) de livraison il veut prendre.
 *  - "all"     : Express + Tournée (défaut)
 *  - "express" : ne prendre que l'Express (auto-pull FIFO)
 *  - "tour"    : ne prendre que les Tournées (pas d'auto-pull Express)
 *
 * Stockée en localStorage (pas de source backend) : c'est un filtre côté client
 * qui aide le livreur à basculer facilement entre les modes. N'altère AUCUNE
 * logique d'attribution serveur — gate seulement l'auto-pull Express côté client.
 */
export type DriverMode = "all" | "express" | "tour";

export const DRIVER_MODE_KEY = "coligo_driver_mode";

export function getDriverMode(): DriverMode {
  if (typeof window === "undefined") return "all";
  const v = localStorage.getItem(DRIVER_MODE_KEY);
  return v === "express" || v === "tour" ? v : "all";
}

export function setDriverMode(m: DriverMode) {
  if (typeof window === "undefined") return;
  localStorage.setItem(DRIVER_MODE_KEY, m);
}

/** L'Express est-il actif pour ce mode ? */
export function modeAllowsExpress(m: DriverMode): boolean {
  return m === "all" || m === "express";
}
