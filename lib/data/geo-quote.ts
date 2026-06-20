import { createClient } from "@/lib/supabase/server";

// =============================================================================
// Devis de prix signés serveur (Partie D du prompt) — accès serveur.
// Émission à l'estimation (issuePriceQuote) ; vérification + consommation à la
// création de course/commande (verifyPriceQuote). La distance est recalculée
// serveur dans la RPC ; le prix/distance du devis font foi.
// =============================================================================

export type QuoteContext = "drive" | "delivery";

export type IssuedQuote = {
  quoteId: string;
  expiresAt: string;
  distanceKm: number;
};

export type QuoteCheck = {
  ok: boolean;
  reason: "ok" | "not_found" | "expired" | "consumed" | "addr_changed";
  priceDa: number | null;
  distanceKm: number | null;
};

type Rpc = (
  fn: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: unknown }>;

/** Émet un devis signé. Renvoie null en cas d'échec (jamais bloquant). */
export async function issuePriceQuote(input: {
  context: QuoteContext;
  pickup: { lat: number; lng: number; text?: string | null };
  dest?: { lat: number; lng: number; text?: string | null } | null;
  priceDa: number;
  wilaya?: string | null;
  commune?: string | null;
  durationMin?: number | null;
  meta?: Record<string, unknown>;
}): Promise<IssuedQuote | null> {
  try {
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;
    const { data, error } = await rpc("geo_quote_issue", {
      p_context: input.context,
      p_pickup_lat: input.pickup.lat,
      p_pickup_lng: input.pickup.lng,
      p_pickup_text: input.pickup.text ?? null,
      p_dest_lat: input.dest?.lat ?? null,
      p_dest_lng: input.dest?.lng ?? null,
      p_dest_text: input.dest?.text ?? null,
      p_price_da: Math.max(0, Math.floor(input.priceDa)),
      p_wilaya: input.wilaya ?? null,
      p_commune: input.commune ?? null,
      p_duration_min: input.durationMin ?? null,
      p_meta: input.meta ?? {},
    });
    if (error) return null;
    const row = (Array.isArray(data) ? data[0] : null) as {
      quote_id: string;
      expires_at: string;
      distance_km: number;
    } | null;
    if (!row?.quote_id) return null;
    return {
      quoteId: row.quote_id,
      expiresAt: row.expires_at,
      distanceKm: Number(row.distance_km ?? 0),
    };
  } catch {
    return null;
  }
}

/**
 * Vérifie (et par défaut consomme) un devis pour le trajet COURANT. Renvoie le
 * prix/distance du devis si valide. Sur échec, `ok=false` + `reason` exploitable
 * pour un message client (« re-demande une estimation »).
 */
export async function verifyPriceQuote(input: {
  quoteId: string;
  context: QuoteContext;
  pickup: { lat: number; lng: number };
  dest?: { lat: number; lng: number } | null;
  consume?: boolean;
}): Promise<QuoteCheck> {
  try {
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;
    const { data, error } = await rpc("geo_quote_verify", {
      p_quote_id: input.quoteId,
      p_context: input.context,
      p_pickup_lat: input.pickup.lat,
      p_pickup_lng: input.pickup.lng,
      p_dest_lat: input.dest?.lat ?? null,
      p_dest_lng: input.dest?.lng ?? null,
      p_consume: input.consume ?? true,
    });
    if (error) {
      return {
        ok: false,
        reason: "not_found",
        priceDa: null,
        distanceKm: null,
      };
    }
    const row = (Array.isArray(data) ? data[0] : null) as {
      ok: boolean;
      reason: QuoteCheck["reason"];
      price_da: number | null;
      distance_km: number | null;
    } | null;
    if (!row) {
      return {
        ok: false,
        reason: "not_found",
        priceDa: null,
        distanceKm: null,
      };
    }
    return {
      ok: Boolean(row.ok),
      reason: row.reason,
      priceDa: row.price_da,
      distanceKm: row.distance_km,
    };
  } catch {
    return { ok: false, reason: "not_found", priceDa: null, distanceKm: null };
  }
}

/** Message FR court par motif de refus d'un devis. */
export function quoteRejectionMessage(reason: QuoteCheck["reason"]): string {
  switch (reason) {
    case "expired":
      return "Le prix a expiré. Re-demande une estimation.";
    case "addr_changed":
      return "L'adresse a changé. Re-demande une estimation.";
    case "consumed":
      return "Devis déjà utilisé. Re-demande une estimation.";
    default:
      return "Estimation introuvable. Re-demande une estimation.";
  }
}
