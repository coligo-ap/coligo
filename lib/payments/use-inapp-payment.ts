"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isNativeApp, openCheckout } from "@/lib/payments/open-checkout";
import type { PaymentResultState } from "@/components/payments/payment-result-overlay";

// =============================================================================
// useInappPayment — orchestration du paiement Chargily DANS l'app (natif).
// =============================================================================
// Ouvre la page de paiement dans le navigateur intégré (l'app reste montée),
// puis pilote l'overlay de résultat : traitement → réussi / échoué / annulé /
// expiré. La CONFIRMATION vient TOUJOURS du webhook (jamais de la redirection,
// forgeable) : `confirm()` sonde la preuve serveur (écriture/statut).
//
// Détection de FERMETURE : `@capacitor/browser` émet `browserFinished` quand
// l'utilisateur ferme l'onglet intégré. Si à ce moment le paiement n'est pas
// encore confirmé, on laisse une courte fenêtre de grâce (le webhook peut
// arriver juste après), puis on conclut « annulé ». Un plafond global borne
// l'attente (« expiré » — le webhook créditera éventuellement en tâche de fond).
//
// SUR LE WEB : pas d'overlay — `openCheckout` redirige, le retour se fait via
// le successUrl / le gestionnaire de retour existant de la page. `start()`
// renvoie alors "redirect" et le composant appelant n'affiche rien.
// =============================================================================

type Confirm = () => Promise<boolean>;

const POLL_MS = 3000;
const MAX_MS = 3 * 60 * 1000; // plafond global d'attente
const GRACE_AFTER_CLOSE_MS = 12_000; // fenêtre de grâce après fermeture de l'onglet

export function useInappPayment(opts: { onPaid?: () => void } = {}) {
  const [state, setState] = useState<PaymentResultState | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishRef = useRef<{ remove: () => void } | null>(null);
  const closedAtRef = useRef<number | null>(null);
  const startedRef = useRef(0);
  const settledRef = useRef(false);
  const onPaidRef = useRef(opts.onPaid);
  onPaidRef.current = opts.onPaid;

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (finishRef.current) finishRef.current.remove();
    finishRef.current = null;
    closedAtRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  /** Ferme l'overlay (à câbler sur les actions primaire/secondaire). */
  const reset = useCallback(() => {
    cleanup();
    setState(null);
  }, [cleanup]);

  /**
   * Lance le paiement. `createUrl` renvoie l'URL Chargily (ou null/erreur).
   * `confirm` sonde la preuve serveur (true = payé). Retourne "redirect" sur
   * le web (aucun overlay), "inapp" en natif (overlay piloté).
   */
  const start = useCallback(
    async (
      createUrl: () => Promise<string | null>,
      confirm: Confirm
    ): Promise<"redirect" | "inapp" | "error"> => {
      const url = await createUrl();
      if (!url) return "error";
      if (!isNativeApp()) {
        // Web : redirection classique (le retour successUrl gère le résultat).
        await openCheckout(url);
        return "redirect";
      }

      // Natif : overlay « traitement » + navigateur intégré + poll webhook.
      settledRef.current = false;
      startedRef.current = Date.now();
      closedAtRef.current = null;
      setState("processing");

      const settle = (s: PaymentResultState) => {
        if (settledRef.current) return;
        settledRef.current = true;
        cleanup();
        setState(s);
        if (s === "success") onPaidRef.current?.();
      };

      // Écoute la fermeture de l'onglet intégré (annulation probable).
      try {
        const { Browser } = await import("@capacitor/browser");
        finishRef.current = await Browser.addListener("browserFinished", () => {
          closedAtRef.current = Date.now();
        });
      } catch {
        /* plugin absent : on se repose sur le poll + le plafond */
      }

      await openCheckout(url);

      const tick = async () => {
        if (settledRef.current) return;
        let paid = false;
        try {
          paid = await confirm();
        } catch {
          /* réseau : on retentera au prochain tick */
        }
        if (paid) return settle("success");
        const now = Date.now();
        if (now - startedRef.current > MAX_MS) return settle("expired");
        // Onglet fermé sans confirmation depuis > fenêtre de grâce → annulé.
        if (
          closedAtRef.current != null &&
          now - closedAtRef.current > GRACE_AFTER_CLOSE_MS
        ) {
          return settle("cancelled");
        }
      };
      void tick();
      timerRef.current = setInterval(() => void tick(), POLL_MS);
      return "inapp";
    },
    [cleanup]
  );

  return { state, start, reset };
}
