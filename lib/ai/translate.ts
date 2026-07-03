import "server-only";

/**
 * Traduction FR → arabe standard via l'API Gemini (tier gratuit AI Studio).
 *
 * - Clé lue depuis GEMINI_API_KEY (jamais exposée au client — fichier serveur).
 * - Envoi EN LOT : un appel traduit jusqu'à MAX_BATCH textes (le quota gratuit
 *   compte par requête, pas par caractère → on regroupe).
 * - Chaîne de repli de modèles : si un modèle est indisponible (404/429/503),
 *   on tente le suivant avant d'abandonner.
 * - Sortie JSON forcée (responseMimeType) et re-validée : même nombre
 *   d'éléments que l'entrée, sinon on considère l'appel raté.
 */

const GEMINI_MODELS = [
  "gemini-flash-lite-latest",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];

/** Nombre max de textes par appel (bien en dessous des limites de tokens). */
export const TRANSLATE_MAX_BATCH = 40;

const PROMPT_RULES = `Tu traduis des libellés e-commerce du français (parfois mêlé de darija algérienne) vers l'arabe standard, pour une marketplace algérienne de livraison (produits alimentaires, restaurants, supérettes).

Règles STRICTES :
- Laisse les noms de marques en alphabet latin tels quels (ex. "Hamoud Boualem", "Elio", "Coca-Cola").
- Conserve les nombres, unités et formats intacts ("1kg", "500ml", "x24", "33cl").
- Les plats/produits locaux gardent leur nom usuel en arabe (ex. "chorba frik" → "شوربة فريك", "garantita" → "قرنطيطة").
- Traduction courte et naturelle, registre commercial, pas d'explication ni d'alternative.
- Ne rien ajouter, ne rien omettre.

Réponds UNIQUEMENT avec un tableau JSON de chaînes, de la MÊME longueur et dans le MÊME ordre que le tableau d'entrée.`;

type GeminiResult =
  | { translations: string[]; error: null }
  | { translations: null; error: string };

function friendlyError(status: number, body: string): string {
  if (status === 429) {
    if (body.includes("prepayment")) {
      return "Quota Gemini bloqué : le projet Google AI Studio est en mode prépaiement sans crédit. Passez le projet en offre gratuite sur aistudio.google.com.";
    }
    return "Quota journalier de traduction atteint. Réessayez plus tard.";
  }
  if (status === 400 || status === 401 || status === 403) {
    return "Clé de traduction invalide ou non autorisée (GEMINI_API_KEY).";
  }
  return "Service de traduction momentanément indisponible.";
}

/**
 * Traduit un lot de textes FR → AR. Renvoie un tableau aligné sur l'entrée.
 * Ne lève jamais : toute panne devient `{ error }` (affichable inline).
 */
export async function translateToArabic(
  texts: string[]
): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      translations: null,
      error: "Traduction non configurée (GEMINI_API_KEY manquante).",
    };
  }
  const cleaned = texts.map((t) => t.trim());
  if (cleaned.length === 0 || cleaned.length > TRANSLATE_MAX_BATCH) {
    return { translations: null, error: "Lot de traduction invalide." };
  }

  let lastError = "Service de traduction indisponible.";
  for (const model of GEMINI_MODELS) {
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `${PROMPT_RULES}\n\nEntrée :\n${JSON.stringify(cleaned)}`,
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          }),
          // Un lot de 40 libellés courts doit répondre vite ; on borne pour ne
          // jamais figer l'action serveur (cf. règle OSRM/AbortController).
          signal: AbortSignal.timeout(30_000),
        }
      );
    } catch {
      lastError = "Service de traduction injoignable (réseau).";
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      lastError = friendlyError(res.status, body);
      // 404 = modèle absent pour cette clé, 429/5xx = quota/panne → modèle suivant.
      continue;
    }

    try {
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const parsed = JSON.parse(raw) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.length === cleaned.length &&
        parsed.every((v) => typeof v === "string")
      ) {
        return { translations: parsed as string[], error: null };
      }
      lastError = "Réponse de traduction mal formée.";
    } catch {
      lastError = "Réponse de traduction illisible.";
    }
  }

  return { translations: null, error: lastError };
}
