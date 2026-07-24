// =============================================================================
// Parrainage — lecture de la vue client (page /parrainage).
// =============================================================================
// Tout passe par la RPC `my_referral_overview` (mig 0403, SECURITY DEFINER) :
// masquage des noms côté serveur et statut PUBLIC (un `held` est montré
// « en attente », jamais une suspicion de fraude). Aucune lecture directe de
// `customer_referrals` côté client.

import { createClient } from "@/lib/supabase/server";

export type ReferralRefereeStatus = "waiting" | "rewarded" | "expired";

export type ReferralReferee = {
  name: string;
  status: ReferralRefereeStatus;
  amount_da: number;
  created_at: string;
};

export type ReferralOverview = {
  code: string;
  enabled: boolean;
  reward_referrer_da: number;
  reward_referee_da: number;
  min_order_da: number;
  stats: {
    invited: number;
    rewarded: number;
    waiting: number;
    earned_da: number;
  };
  referees: ReferralReferee[];
};

export async function getMyReferralOverview(): Promise<ReferralOverview | null> {
  try {
    const supabase = await createClient();
    // RPC hors types générés → bind OBLIGATOIRE (reference_supabase_rpc_bind).
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string
    ) => Promise<{
      data: ReferralOverview | null;
      error: { message: string } | null;
    }>;
    const { data, error } = await rpc("my_referral_overview");
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}
