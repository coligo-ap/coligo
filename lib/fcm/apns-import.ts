/**
 * Conversion serveur APNs brut → token FCM (API IID `batchImport`).
 *
 * POURQUOI : le binaire iOS App Store approuvé le 22/07/2026 embarque l'ancien
 * AppDelegate qui relaie le token APNs BRUT (hex) au lieu du token FCM (corrigé
 * en build 30, publié après). Ces tokens étaient rejetés à la source (garde 422
 * de /api/device-tokens) → AUCUNE push (personnelle ou promo) n'atteignait les
 * iPhone. Plutôt que d'attendre une nouvelle revue Apple, on convertit côté
 * serveur : l'API IID transforme un token APNs en token FCM standard, utilisable
 * par l'envoi HTTP v1 et les topics — les binaires DÉJÀ installés remarchent.
 *
 * `sandbox:false` d'abord (App Store/TestFlight = APNs production, cf.
 * aps-environment=production dans App.entitlements), repli sandbox pour un
 * éventuel build Xcode de dev. Best-effort : null si l'import échoue.
 */

import { getFcmAccessToken } from "./send";

const IID_IMPORT = "https://iid.googleapis.com/iid/v1:batchImport";
const IOS_BUNDLE_ID = "app.coligo.client";

/** Un token APNs brut = uniquement de l'hexadécimal (un token FCM contient « : »). */
export function isRawApnsToken(token: string): boolean {
  return /^[0-9a-fA-F]{40,}$/.test(token);
}

type ImportResult = {
  results?: Array<{
    apns_token?: string;
    status?: string;
    registration_token?: string;
  }>;
};

export async function importApnsToken(hex: string): Promise<string | null> {
  const ctx = await getFcmAccessToken();
  if (!ctx) return null;
  for (const sandbox of [false, true]) {
    try {
      const res = await fetch(IID_IMPORT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
          access_token_auth: "true",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          application: IOS_BUNDLE_ID,
          sandbox,
          apns_tokens: [hex],
        }),
      });
      if (!res.ok) continue;
      const body = (await res.json().catch(() => null)) as ImportResult | null;
      const r = body?.results?.[0];
      if (r?.status === "OK" && typeof r.registration_token === "string") {
        return r.registration_token;
      }
    } catch (err) {
      console.warn("[fcm apns-import] error:", err);
    }
  }
  return null;
}
