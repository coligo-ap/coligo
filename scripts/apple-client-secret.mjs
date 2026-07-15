// Génère le client_secret « Sign in with Apple » (JWT ES256) à coller dans
// Supabase → Authentication → Providers → Apple → « Secret Key (for OAuth) ».
//
// Usage :
//   node scripts/apple-client-secret.mjs <chemin/vers/AuthKey_XXXXXXXXXX.p8> <KEY_ID>
//
// - Le .p8 est la clé « Sign in with Apple » téléchargée sur
//   developer.apple.com (PAS la clé APNs — vérifier le Key ID).
// - Apple limite la validité à 6 mois : le script affiche la date d'expiration,
//   il faudra le relancer et recoller le secret dans Supabase avant l'échéance.
// - Ne JAMAIS committer un fichier .p8 dans le repo.

import { readFileSync } from "node:fs";

const TEAM_ID = "PRB75K5S58";
// Service ID (web auth) — le client_id côté Supabase/web.
const CLIENT_ID = "app.coligo.client.auth";

const [, , p8Path, keyId] = process.argv;
if (!p8Path || !keyId) {
  console.error(
    "Usage : node scripts/apple-client-secret.mjs <fichier.p8> <KEY_ID>"
  );
  process.exit(1);
}

const pem = readFileSync(p8Path, "utf8");
const der = Buffer.from(
  pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, ""),
  "base64"
);

const key = await crypto.subtle.importKey(
  "pkcs8",
  der,
  { name: "ECDSA", namedCurve: "P-256" },
  false,
  ["sign"]
);

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const exp = now + 15_550_000; // ~180 jours (max Apple : 15 777 000 s)

const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
const payload = b64url(
  JSON.stringify({
    iss: TEAM_ID,
    iat: now,
    exp,
    aud: "https://appleid.apple.com",
    sub: CLIENT_ID,
  })
);
// WebCrypto renvoie la signature ECDSA au format brut r||s (64 octets),
// exactement ce qu'attend un JWS ES256 — pas de conversion DER nécessaire.
const signature = await crypto.subtle.sign(
  { name: "ECDSA", hash: "SHA-256" },
  key,
  Buffer.from(`${header}.${payload}`)
);

console.log(`${header}.${payload}.${b64url(signature)}`);
console.error(
  `\nSecret généré pour ${CLIENT_ID} (team ${TEAM_ID}, clé ${keyId}).` +
    `\nExpire le ${new Date(exp * 1000).toLocaleDateString("fr-FR")} — à régénérer et recoller dans Supabase avant cette date.`
);
