import { createClient } from "@/lib/supabase/server";

// =============================================================================
// Flag serveur : le transfert P2P Coligo Pay (Envoyer / Recevoir entre clients)
// est-il activé ? Source unique = platform_settings.p2p_enabled (défaut false).
// =============================================================================
// Sert à MASQUER toutes les surfaces P2P dans l'UI tant qu'il est faux (exigence
// Google Play : une app à « crédit fermé » ne doit exposer AUCUN transfert
// d'argent entre utilisateurs, sinon = fonctionnalité financière régulée
// « Money transfer » → compte organisation obligatoire). La garde DURE reste
// côté SQL (coligo_pay_transfer → p2p_disabled) ; ce flag ne fait que cacher.
// Repasser p2p_enabled = true réaffiche Envoyer/Recevoir partout d'un coup.
// =============================================================================
export async function getP2pEnabled(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_settings")
    .select("p2p_enabled")
    .eq("id", true)
    .maybeSingle();
  return data?.p2p_enabled ?? false;
}
