"use server";

/**
 * Assistant Drive en langage naturel (darija / arabe / français).
 *
 * Principe : l'IA NE FAIT QUE COMPRENDRE. Elle extrait l'intention de course
 * depuis la phrase du client (destination, gamme, femme au volant…). Tout le
 * reste — géocodage, distance, prix recommandé — est calculé par le code
 * déterministe existant, jamais par le modèle (anti-hallucination de prix/lieu).
 *
 * Le résultat est un BROUILLON : le client le confirme ensuite via l'écran prix
 * habituel (devis, paiement, bouton de demande). `request_ride` reste seul juge
 * de la création réelle de la course. L'IA ne déclenche aucune dépense.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { geocodeSearch } from "@/app/(customer)/actions";
import { haversineKm } from "@/lib/delivery/distance";

// Modèle volontairement léger : l'extraction est simple et le gazetteer local
// fait le gros du travail de résolution des graphies darija. Rapide + peu cher
// pour un endpoint très sollicité. Passer à "claude-sonnet-4-6" si la
// compréhension du darija s'avère insuffisante en production.
const AI_MODEL = "claude-haiku-4-5";

export type DriveGamme = "classic" | "confort" | "moto";

export type DriveIntentDraft = {
  /** Départ : position GPS actuelle (text null) sauf si le client en nomme un autre. */
  pickup: { lat: number; lng: number; text: string | null };
  destination: { lat: number; lng: number; text: string };
  /** Autres lieux candidats pour la destination (si ambiguë), à proposer au client. */
  alternatives: { lat: number; lng: number; display: string }[];
  distance_km: number;
  gamme: DriveGamme;
  female_only: boolean;
  urgent: boolean;
  suggested_price_da: number;
};

export type DriveIntentResult =
  | { ok: true; draft: DriveIntentDraft }
  | {
      ok: false;
      reason: "auth" | "input" | "config" | "parse" | "not_found" | "error";
      message: string;
    };

type RawIntent = {
  understood: boolean;
  destination_query: string;
  pickup_query: string;
  gamme: DriveGamme;
  female_only: boolean;
  urgent: boolean;
  reply: string;
};

// Schéma d'outil : force le modèle à renvoyer une structure validée (plus
// robuste que de parser du texte libre — l'« input » revient déjà typé).
const INTENT_TOOL = {
  name: "reserver_course",
  description:
    "Enregistre l'intention de course VTC extraite de la phrase du client.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      understood: {
        type: "boolean",
        description: "true si une destination de course a été comprise.",
      },
      destination_query: {
        type: "string",
        description:
          "Lieu d'ARRIVÉE à géocoder, le plus précis possible (ex: 'Carrefour El Mohammadia Alger', 'gare routière Akbou'). Garder les noms de lieux tels quels, nettoyer le bruit. Chaîne vide si non compris.",
      },
      pickup_query: {
        type: "string",
        description:
          "Lieu de DÉPART UNIQUEMENT si le client en nomme un explicitement différent de sa position actuelle ('depuis...', 'men...'). Chaîne vide sinon.",
      },
      gamme: {
        type: "string",
        enum: ["classic", "confort", "moto"],
        description:
          "classic par défaut ; 'confort' si voiture confort/premium ; 'moto' si moto/clando.",
      },
      female_only: {
        type: "boolean",
        description: "true si une femme au volant / chauffeure est demandée.",
      },
      urgent: {
        type: "boolean",
        description: "true si urgence (vite, maintenant, daghya, fissa).",
      },
      reply: {
        type: "string",
        description:
          "Si understood=false : courte question en darija/français pour faire préciser la destination. Sinon chaîne vide.",
      },
    },
    required: [
      "understood",
      "destination_query",
      "pickup_query",
      "gamme",
      "female_only",
      "urgent",
      "reply",
    ],
  },
};

const SYSTEM = `Tu es l'assistant de réservation de courses VTC de Coligo, en Algérie.
Le client écrit en darija algérien, en arabe et/ou en français (souvent mélangés) pour réserver un trajet (transport de personnes, comme Yassir/Uber).
Ta seule tâche : extraire l'intention de course, sans rien inventer.
- destination_query : l'endroit où le client veut ALLER. Garde les noms de lieux tels qu'il les dit (un moteur de recherche local les résoudra) ; enlève seulement le bruit ("je veux aller vers", "khouya"…).
- pickup_query : uniquement si le client nomme un point de DÉPART différent de sa position actuelle. Sinon, laisse vide.
- N'ajoute JAMAIS une ville ou une wilaya que le client n'a pas mentionnée.
- Si aucune destination claire, understood=false et pose une courte question dans reply.
Appelle toujours l'outil reserver_course.`;

const GAMMES: DriveGamme[] = ["classic", "confort", "moto"];

export async function parseDriveIntent(input: {
  text: string;
  pickup: { lat: number; lng: number } | null;
}): Promise<DriveIntentResult> {
  // 1. Réservé aux clients connectés (anti-abus / coût du endpoint IA).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return {
      ok: false,
      reason: "auth",
      message: "Connecte-toi pour utiliser l'assistant.",
    };

  const text = (input.text ?? "").trim();
  if (text.length < 3 || text.length > 500)
    return {
      ok: false,
      reason: "input",
      message: "Dis en quelques mots où tu veux aller.",
    };

  if (!process.env.ANTHROPIC_API_KEY)
    return {
      ok: false,
      reason: "config",
      message: "Assistant indisponible pour le moment.",
    };

  // 2. Compréhension du langage naturel (extraction pure, aucun calcul).
  let intent: RawIntent;
  try {
    const anthropic = new Anthropic();
    const resp = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 400,
      system: SYSTEM,
      tools: [INTENT_TOOL],
      tool_choice: { type: "tool", name: "reserver_course" },
      messages: [{ role: "user", content: text }],
    });
    const toolUse = resp.content.find((b) => b.type === "tool_use");
    if (!toolUse || !("input" in toolUse)) throw new Error("no_tool_use");
    intent = toolUse.input as RawIntent;
  } catch {
    return {
      ok: false,
      reason: "error",
      message: "L'assistant n'a pas pu traiter ta demande, réessaie.",
    };
  }

  const destQuery = (intent.destination_query ?? "").trim();
  if (!intent.understood || !destQuery)
    return {
      ok: false,
      reason: "parse",
      message: intent.reply?.trim() || "Précise vers où tu veux aller.",
    };

  const gamme: DriveGamme = GAMMES.includes(intent.gamme)
    ? intent.gamme
    : "classic";
  const bias = input.pickup ?? undefined;

  // 3. Géocodage déterministe (gazetteer DZ darija + repli Photon/Nominatim).
  const destRes = await geocodeSearch({
    q: destQuery,
    lat: bias?.lat,
    lng: bias?.lng,
  });
  const destHit = destRes.ok ? destRes.results[0] : undefined;
  if (!destHit)
    return {
      ok: false,
      reason: "not_found",
      message: `Je n'ai pas trouvé « ${destQuery} ». Précise le quartier ou la ville.`,
    };

  // Départ : position GPS actuelle, sauf si le client nomme un autre point.
  let pickup: DriveIntentDraft["pickup"] | null = input.pickup
    ? { lat: input.pickup.lat, lng: input.pickup.lng, text: null }
    : null;
  const pickupQuery = (intent.pickup_query ?? "").trim();
  if (pickupQuery) {
    const pRes = await geocodeSearch({
      q: pickupQuery,
      lat: bias?.lat,
      lng: bias?.lng,
    });
    const pHit = pRes.ok ? pRes.results[0] : undefined;
    if (pHit) pickup = { lat: pHit.lat, lng: pHit.lng, text: pHit.display };
  }
  if (!pickup)
    return {
      ok: false,
      reason: "not_found",
      message: "Active ta position ou indique d'où tu pars.",
    };

  // 4. Distance (vol d'oiseau ×1,25 ≈ route, cohérent avec l'app) + prix
  //    recommandé via la RPC existante. Calcul 100 % code, jamais l'IA.
  const distance_km = Number(
    (
      haversineKm(pickup, { lat: destHit.lat, lng: destHit.lng }) * 1.25
    ).toFixed(2)
  );
  let suggested = 0;
  try {
    // ⚠️ .bind(supabase) + cast : contourne le typage RPC et le piège this.rest
    // (cf. pattern rpcClient des autres actions Drive).
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data } = await rpc("drive_recommended_price", {
      p_distance_km: distance_km,
      p_gamme: gamme,
    });
    suggested = Number(data) || 0;
  } catch {
    suggested = 0;
  }

  return {
    ok: true,
    draft: {
      pickup,
      destination: {
        lat: destHit.lat,
        lng: destHit.lng,
        text: destHit.display,
      },
      alternatives: (destRes.ok ? destRes.results.slice(1, 4) : []).map(
        (r) => ({
          lat: r.lat,
          lng: r.lng,
          display: r.display,
        })
      ),
      distance_km,
      gamme,
      female_only: !!intent.female_only,
      urgent: !!intent.urgent,
      suggested_price_da: suggested,
    },
  };
}
