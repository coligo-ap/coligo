"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// =============================================================================
// Visibilité CLIENT du réseau d'agents Coligo Pay (drapeau `coligo_pay_agents`,
// mig 0449). Pour les composants « use client » PROFONDS qui ne reçoivent pas
// les drapeaux serveur en props (feuille « Espaces partenaires » des portails,
// SubscribeSheet des abonnements chauffeur). Les pages serveur, elles, lisent
// `getFeatureFlags()` et passent la valeur en prop — ce hook n'est PAS un
// substitut.
//
// Lecture UNIQUE par onglet (cache module + promesse partagée) sur
// feature_flags (SELECT ouvert à tous, mig 0182). Tant que le statut n'est pas
// connu, on MASQUE : ne jamais montrer un domaine potentiellement désactivé,
// il apparaît dès confirmation (< 300 ms, puis instantané via le cache).
// Échec de lecture ⇒ visible (jamais bloquer le front sur une erreur réseau).
// =============================================================================

let cached: boolean | null = null;
let pending: Promise<boolean> | null = null;

function fetchAgentsVisible(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  pending ??= (async () => {
    try {
      const supabase = createClient();
      // `feature_flags` hors types générés → cast du `from` BINDÉ (piège connu).
      const from = supabase.from.bind(supabase) as unknown as (t: string) => {
        select: (c: string) => {
          eq: (
            c: string,
            v: string
          ) => {
            maybeSingle: () => Promise<{ data: { status: string } | null }>;
          };
        };
      };
      const { data } = await from("feature_flags")
        .select("status")
        .eq("key", "coligo_pay_agents")
        .maybeSingle();
      // Ligne absente = défaut actif (même convention que getFeatureFlags).
      cached = !data || data.status === "active";
    } catch {
      cached = true;
    }
    return cached;
  })();
  return pending;
}

/** Le réseau d'agents Coligo Pay est-il visible sur la plateforme ? */
export function useAgentsVisible(): boolean {
  const [visible, setVisible] = useState(cached ?? false);
  useEffect(() => {
    void fetchAgentsVisible().then(setVisible);
  }, []);
  return visible;
}
