// =============================================================================
// Authentification App Store Connect (JWT ES256) — socle partagé.
//
// Apple exige un jeton signé avec la clé .p8 : `iss` = Issuer ID, `kid` = Key
// ID, `aud` = appstoreconnect-v1, durée MAXIMALE 20 minutes (au-delà, Apple
// refuse le jeton lui-même, pas seulement la requête).
//
// La clé privée n'est JAMAIS journalisée ni versionnée (.secrets/ est ignoré).
// =============================================================================
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function env(name, fallback = null) {
  const raw = readFileSync(resolve(root, ".env.local"), "utf8");
  const m = raw.match(new RegExp(`^${name}=(.*)$`, "m"));
  return m ? m[1].trim() : fallback;
}

const b64u = (buf) =>
  Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** Jeton App Store Connect valable 15 min (marge sous la limite Apple). */
export function ascToken() {
  const keyId = env("ASC_KEY_ID");
  const issuer = env("ASC_ISSUER_ID");
  const keyPath = env("ASC_KEY_PATH", ".secrets/AuthKey_D6KPZB5K86.p8");
  if (!keyId || !issuer)
    throw new Error("ASC_KEY_ID / ASC_ISSUER_ID manquants");
  const key = readFileSync(resolve(root, keyPath), "utf8");

  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = b64u(
    JSON.stringify({
      iss: issuer,
      iat: now,
      exp: now + 15 * 60,
      aud: "appstoreconnect-v1",
    })
  );
  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  // Apple attend une signature ES256 « brute » (r||s), pas du DER.
  const sig = signer.sign({ key, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${b64u(sig)}`;
}

const BASE = "https://api.appstoreconnect.apple.com/v1";

/** Appel API : renvoie le JSON, ou lève une erreur lisible. */
export async function asc(path, init = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${ascToken()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const detail = (json.errors ?? [])
      .map((e) => `${e.title}: ${e.detail}`)
      .join(" | ");
    throw new Error(`${res.status} ${detail || text.slice(0, 200)}`);
  }
  return json;
}

export { BASE };
