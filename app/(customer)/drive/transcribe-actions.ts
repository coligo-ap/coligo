"use server";

// =============================================================================
// Transcription vocale SERVEUR pour l'assistant Drive — repli universel quand
// ni le plugin natif ni l'API Web Speech ne sont disponibles (WebView APK).
// Le client enregistre un court audio (MediaRecorder) et l'envoie ici.
//
// Moteur principal : Groq Whisper (tier gratuit, GROQ_API_KEY — même clé que
// la traduction). Secours : Gemini audio inline (GEMINI_API_KEY si présente).
// Best-effort : jamais de throw vers le client.
// =============================================================================

export type TranscribeResult = { ok: true; text: string } | { ok: false };

const GROQ_WHISPER_MODELS = ["whisper-large-v3-turbo", "whisper-large-v3"];

export async function transcribeDriveAudio(input: {
  /** Audio encodé base64 (webm/opus, ogg ou mp4), ≤ ~3 Mo. */
  base64: string;
  mime: string;
  lang: "ar" | "fr";
}): Promise<TranscribeResult> {
  const b64 = input.base64 ?? "";
  // ~3 Mo décodés — largement assez pour 15 s de dictée, et borne anti-abus.
  if (!b64 || b64.length > 4_000_000) return { ok: false };
  const mime = /^audio\/[a-z0-9.+-]+$/i.test(input.mime)
    ? input.mime
    : "audio/webm";
  const lang = input.lang === "ar" ? "ar" : "fr";

  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return { ok: false };
  }
  if (buf.length < 200) return { ok: false };
  // Copie en ArrayBuffer « pur » (le typage Buffer expose ArrayBufferLike).
  const audioBytes = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength
  ) as ArrayBuffer;

  const ext = mime.includes("mp4")
    ? "mp4"
    : mime.includes("ogg")
      ? "ogg"
      : "webm";

  // ⚠️ Si Groq renvoie 403 `model_permission_blocked_org` : les modèles
  // Whisper sont désactivés au niveau ORGANISATION → les activer sur
  // https://console.groq.com/settings/limits (aucun redéploiement requis).
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    for (const model of GROQ_WHISPER_MODELS) {
      try {
        const fd = new FormData();
        fd.append(
          "file",
          new Blob([audioBytes], { type: mime }),
          `dictee.${ext}`
        );
        fd.append("model", model);
        // Indice de langue (Whisper gère très bien le mélange darija/fr).
        fd.append("language", lang);
        fd.append("response_format", "json");
        fd.append("temperature", "0");
        const res = await fetch(
          "https://api.groq.com/openai/v1/audio/transcriptions",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${groqKey}` },
            body: fd,
          }
        );
        if (!res.ok) continue;
        const j = (await res.json()) as { text?: string };
        const text = (j.text ?? "").trim();
        if (text) return { ok: true, text };
      } catch {
        /* modèle suivant */
      }
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const res = await fetch(
        // Auth par EN-TÊTE (comme lib/ai/translate.ts) : `?key=` rejette les
        // clés récentes (401 « Expected OAuth 2 access token »).
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": geminiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: "Transcris fidèlement cet audio (français, arabe ou darija algérienne). Réponds UNIQUEMENT avec la transcription, sans commentaire ni ponctuation ajoutée.",
                  },
                  { inline_data: { mime_type: mime, data: b64 } },
                ],
              },
            ],
          }),
        }
      );
      if (res.ok) {
        const j = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = (
          j.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
        ).trim();
        if (text) return { ok: true, text };
      }
    } catch {
      /* silencieux */
    }
  }

  return { ok: false };
}
