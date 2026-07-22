"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";
import {
  clearSessionBackup,
  syncOrRestoreSession,
} from "@/lib/auth/session-keeper";

/**
 * Monté dans les coques d'espace : garde la session utilisable au retour dans
 * l'app (notamment après un paiement passé par une page externe).
 *
 * - au montage et à CHAQUE retour au premier plan : on synchronise la copie de
 *   session, et on la RÉINSTALLE si la WebView est revenue sans ses cookies ;
 * - une restauration déclenche un `router.refresh()` SOUPLE pour que le rendu
 *   serveur reparte authentifié (sans démonter l'écran ni perdre la saisie) ;
 * - à la déconnexion (`SIGNED_OUT`), la copie est effacée : on ne ressuscite
 *   JAMAIS une session que l'utilisateur a volontairement fermée.
 */
export function SessionKeeper() {
  const router = useRouter();
  const busy = useRef(false);

  const run = useRef(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (await syncOrRestoreSession()) router.refresh();
    } finally {
      busy.current = false;
    }
  });

  useEffect(() => {
    void run.current();
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        void clearSessionBackup();
        return;
      }
      // Nouvelle session / jeton rafraîchi → la copie suit.
      if (session) void run.current();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Retour au premier plan : c'est LE moment où la WebView peut revenir sans
  // ses cookies (app remise en avant après un paiement, un appel, une veille).
  useResumeResync(() => void run.current());

  return null;
}
