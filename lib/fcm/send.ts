/**
 * Envoi de push FCM via l'API HTTP v1 (recommandée par Google ;
 * les legacy server keys sont dépréciées).
 *
 * Authentification : JWT signé avec la clé de compte de service →
 * access_token OAuth2 court (cf. `google-auth-library`), ré-utilisable
 * ~55 min avant expiration. On ne recrée pas le JWT à chaque envoi.
 *
 * On évite volontairement `firebase-admin` (~30 deps, init lourde) :
 * `google-auth-library` + `fetch` suffit pour le seul usage messaging.
 *
 * Sécurité : la clé de compte de service est lue UNIQUEMENT depuis l'env
 * (`FCM_PROJECT_ID` / `FCM_CLIENT_EMAIL` / `FCM_PRIVATE_KEY`). Aucune valeur
 * en dur. La `private_key` accepte `\n` littéraux (Vercel UI textarea) OU
 * réels — on normalise avant signature.
 */

import { JWT } from "google-auth-library";
import { createAdminClient } from "@/lib/supabase/admin";

const SCOPES = ["https://www.googleapis.com/auth/firebase.messaging"];

type FcmContext = {
  jwt: JWT;
  projectId: string;
};

let cached: FcmContext | null = null;

function getContext(): FcmContext | null {
  if (cached) return cached;
  const projectId = process.env.FCM_PROJECT_ID?.trim();
  const clientEmail = process.env.FCM_CLIENT_EMAIL?.trim();
  const rawKey = process.env.FCM_PRIVATE_KEY;
  if (!projectId || !clientEmail || !rawKey) return null;
  // L'UI Vercel stocke souvent la clé avec `\n` textuels (escapés) ; en dev
  // local on peut avoir des retours à la ligne réels. On normalise.
  const privateKey = rawKey.includes("\\n")
    ? rawKey.replace(/\\n/g, "\n")
    : rawKey;
  const jwt = new JWT({ email: clientEmail, key: privateKey, scopes: SCOPES });
  cached = { jwt, projectId };
  return cached;
}

export type FcmNotification = {
  title: string;
  body: string;
};

export type FcmData = Record<string, string>;

type SendResult = {
  ok: number;
  invalidTokens: string[];
};

/**
 * Envoie une push à une liste de tokens. Renvoie le nombre de succès et la
 * liste des tokens à invalider (réponse FCM `UNREGISTERED` ou `INVALID_ARGUMENT` —
 * appareil désinstallé ou token périmé). Le caller décide quand purger
 * `device_tokens` ; ici on retourne juste le verdict.
 *
 * En cas de config FCM manquante, log + retourne `{ ok: 0, invalidTokens: [] }`
 * pour ne PAS faire planter le flux applicatif (la création de commande doit
 * réussir même si les push sont désactivées).
 */
export async function sendFcm(
  tokens: string[],
  notification: FcmNotification,
  data: FcmData = {}
): Promise<SendResult> {
  if (tokens.length === 0) return { ok: 0, invalidTokens: [] };
  const ctx = getContext();
  if (!ctx) {
    console.warn("[fcm] FCM_* env vars missing — push skipped");
    return { ok: 0, invalidTokens: [] };
  }

  let accessToken: string | null;
  try {
    const { token } = await ctx.jwt.getAccessToken();
    accessToken = token ?? null;
  } catch (err) {
    console.error("[fcm] OAuth token fetch failed:", err);
    return { ok: 0, invalidTokens: [] };
  }
  if (!accessToken) return { ok: 0, invalidTokens: [] };

  const url = `https://fcm.googleapis.com/v1/projects/${ctx.projectId}/messages:send`;
  const invalidTokens: string[] = [];
  let ok = 0;

  await Promise.all(
    tokens.map(async (deviceToken) => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: deviceToken,
              notification,
              data,
              android: {
                priority: "HIGH",
                notification: {
                  channel_id: "coligo_orders",
                  default_sound: true,
                  default_vibrate_timings: true,
                },
              },
            },
          }),
        });
        if (res.ok) {
          ok++;
          return;
        }
        // Lecture du code d'erreur FCM pour décider d'invalider le token.
        const body = (await res.json().catch(() => null)) as {
          error?: { details?: Array<{ errorCode?: string }>; status?: string };
        } | null;
        const errCode =
          body?.error?.details?.find((d) => d.errorCode)?.errorCode ??
          body?.error?.status ??
          "";
        if (
          res.status === 404 ||
          errCode === "UNREGISTERED" ||
          errCode === "INVALID_ARGUMENT" ||
          errCode === "NOT_FOUND"
        ) {
          invalidTokens.push(deviceToken);
        } else if (process.env.NODE_ENV !== "production") {
          console.warn("[fcm] send failed", res.status, errCode, body);
        }
      } catch (err) {
        console.warn("[fcm] fetch error:", err);
      }
    })
  );

  // Purge les tokens invalides — service_role nécessaire car ils peuvent
  // appartenir à n'importe quel user.
  if (invalidTokens.length > 0) {
    const admin = createAdminClient();
    await admin
      .from("device_tokens")
      .delete()
      .in("token", invalidTokens)
      .then(({ error }) => {
        if (error) console.warn("[fcm] purge invalid tokens failed:", error);
      });
  }

  return { ok, invalidTokens };
}
