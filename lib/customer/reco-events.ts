"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * PHASE 5 — collecte d'événements de recommandation, BEST-EFFORT et
 * non bloquante (jamais d'impact sur la navigation). Écriture seule
 * (RLS mig 0315 : INSERT anon/auth, customer_id auto = auth.uid, aucune
 * lecture client). Matière d'apprentissage des pondérations (CTR).
 */
export function logMerchantEvent(
  merchantId: string,
  kind: "view" | "click"
): void {
  try {
    const supabase = createClient();
    void supabase
      .from("reco_events" as never)
      .insert({ merchant_id: merchantId, kind } as never)
      .then(
        () => undefined,
        () => undefined
      );
  } catch {
    /* best-effort */
  }
}
