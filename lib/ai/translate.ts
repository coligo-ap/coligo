import "server-only";

/**
 * Traduction FR → arabe standard, côté serveur uniquement.
 *
 * Moteur principal : Groq (tier gratuit sans carte, GROQ_API_KEY).
 * Secours : Gemini (GEMINI_API_KEY) si Groq échoue ET que la clé existe —
 * aujourd'hui le compte Google du proprio n'a pas de tier gratuit Gemini
 * (prépaiement imposé), mais si ça se débloque un jour le repli est déjà là.
 *
 * - Envoi EN LOT : un appel traduit jusqu'à TRANSLATE_MAX_BATCH textes (les
 *   quotas gratuits comptent par requête → on regroupe).
 * - Chaîne de repli de modèles : les modèles Groq de qualité (70B, GPT-OSS,
 *   Qwen) peuvent être bloqués au niveau du projet Groq
 *   (console.groq.com/settings/project/limits) ; on essaie du meilleur au
 *   moins bon et on prend le premier autorisé.
 * - Sortie JSON forcée et re-validée : même nombre d'éléments que l'entrée,
 *   sinon l'appel est considéré raté.
 */

/** Du meilleur au moins bon — le projet Groq peut en bloquer certains. */
const GROQ_MODELS = [
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b",
  "qwen/qwen3-32b",
  "llama-3.1-8b-instant",
];

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
- Ne rien ajouter, ne rien omettre. N'utilise QUE l'alphabet arabe ou latin (jamais d'autres alphabets).

Réponds UNIQUEMENT en JSON de la forme {"t": [...]} où "t" est un tableau de chaînes de la MÊME longueur et dans le MÊME ordre que le tableau d'entrée.`;

type TranslateResult =
  | { translations: string[]; error: null }
  | { translations: null; error: string };

/** Valide qu'une réponse parsée est bien un tableau aligné sur l'entrée. */
function validateArray(parsed: unknown, expected: number): string[] | null {
  if (
    Array.isArray(parsed) &&
    parsed.length === expected &&
    parsed.every((v) => typeof v === "string")
  ) {
    return parsed as string[];
  }
  return null;
}

async function tryGroq(
  texts: string[],
  apiKey: string
): Promise<TranslateResult> {
  let lastError = "Service de traduction indisponible.";
  for (const model of GROQ_MODELS) {
    let res: Response;
    try {
      res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: PROMPT_RULES },
            { role: "user", content: JSON.stringify(texts) },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      lastError = "Service de traduction injoignable (réseau).";
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (body.includes("model_permission_blocked_project")) {
        // Modèle bloqué dans les réglages du projet Groq → suivant.
        lastError =
          "Modèles de traduction bloqués dans les réglages du projet Groq (console.groq.com → Settings → Limits).";
        continue;
      }
      if (res.status === 429) {
        lastError =
          "Quota journalier de traduction atteint. Réessayez plus tard.";
      } else if (res.status === 401 || res.status === 403) {
        lastError = "Clé de traduction invalide (GROQ_API_KEY).";
      } else {
        lastError = "Service de traduction momentanément indisponible.";
      }
      continue;
    }

    try {
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const raw = data.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(raw) as { t?: unknown };
      const translations = validateArray(parsed?.t, texts.length);
      if (translations) return { translations, error: null };
      lastError = "Réponse de traduction mal formée.";
    } catch {
      lastError = "Réponse de traduction illisible.";
    }
  }
  return { translations: null, error: lastError };
}

async function tryGemini(
  texts: string[],
  apiKey: string
): Promise<TranslateResult> {
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
                    text: `${PROMPT_RULES}\n\nEntrée :\n${JSON.stringify(texts)}`,
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          }),
          signal: AbortSignal.timeout(30_000),
        }
      );
    } catch {
      lastError = "Service de traduction injoignable (réseau).";
      continue;
    }

    if (!res.ok) {
      lastError =
        res.status === 429
          ? "Quota de traduction Gemini atteint."
          : "Traduction Gemini indisponible.";
      continue;
    }

    try {
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const parsed = JSON.parse(raw) as unknown;
      // Gemini peut renvoyer directement le tableau ou l'objet {"t": [...]}.
      const translations =
        validateArray(parsed, texts.length) ??
        validateArray((parsed as { t?: unknown })?.t, texts.length);
      if (translations) return { translations, error: null };
      lastError = "Réponse de traduction mal formée.";
    } catch {
      lastError = "Réponse de traduction illisible.";
    }
  }
  return { translations: null, error: lastError };
}

/**
 * Traduit un lot de textes FR → AR. Renvoie un tableau aligné sur l'entrée.
 * Ne lève jamais : toute panne devient `{ error }` (affichable inline).
 */
export async function translateToArabic(
  texts: string[]
): Promise<TranslateResult> {
  const cleaned = texts.map((t) => t.trim());
  if (cleaned.length === 0 || cleaned.length > TRANSLATE_MAX_BATCH) {
    return { translations: null, error: "Lot de traduction invalide." };
  }

  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!groqKey && !geminiKey) {
    return {
      translations: null,
      error: "Traduction non configurée (GROQ_API_KEY manquante).",
    };
  }

  let lastError = "Traduction indisponible.";
  if (groqKey) {
    const result = await tryGroq(cleaned, groqKey);
    if (result.translations) return result;
    lastError = result.error;
  }
  if (geminiKey) {
    const result = await tryGemini(cleaned, geminiKey);
    if (result.translations) return result;
    if (!groqKey) lastError = result.error;
  }
  return { translations: null, error: lastError };
}
