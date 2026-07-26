// Upload du .aab client sur Google Play via l'API Android Publisher.
// Usage : node scripts/play-upload.mjs [--track alpha] [--status completed] [--also internal] [--aab <chemin>]
// Release standard (alpha pour le chrono prod + interne pour se tester vite) :
//   node scripts/build-client-aab.mjs && node scripts/play-upload.mjs --track alpha --status completed --also internal
// Auth : clé du compte de service play-publisher (play-service-account.json à la racine, gitignorée).
// Par défaut : canal de test interne, release en brouillon (déployable depuis Play Console).
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JWT } from "google-auth-library";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "app.coligo.client";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const track = opt("track", "internal");
const status = opt("status", "draft");
// Pistes SUPPLÉMENTAIRES à servir avec le même bundle, dans le même edit
// (répétable : --also internal --also beta). Sert à publier alpha + interne
// d'un coup : l'interne est dispo en minutes pour se tester soi-même, l'alpha
// fait tourner le chrono 14 j/12 testeurs de l'accès prod.
const alsoTracks = args.reduce(
  (acc, a, i) => (a === "--also" && args[i + 1] ? [...acc, args[i + 1]] : acc),
  []
);
const allTracks = [track, ...alsoTracks];
const aabPath = resolve(
  root,
  opt(
    "aab",
    "android/app/build/outputs/bundle/clientRelease/app-client-release.aab"
  )
);

const key = JSON.parse(
  readFileSync(resolve(root, "play-service-account.json"), "utf8")
);
const jwt = new JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ["https://www.googleapis.com/auth/androidpublisher"],
});
const { token } = await jwt.getAccessToken();

const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;

async function api(method, url, body, headers = {}) {
  const isRaw = body instanceof Uint8Array;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body && !isRaw ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? (isRaw ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${method} ${url}\n→ HTTP ${res.status}\n${text}`);
  return text ? JSON.parse(text) : null;
}

console.log(`AAB    : ${aabPath}`);
console.log(`Pistes : ${allTracks.join(" + ")} (release ${status})`);

const edit = await api("POST", `${base}/edits`);

const bundle = await api(
  "POST",
  `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}/edits/${edit.id}/bundles?uploadType=media`,
  new Uint8Array(readFileSync(aabPath)),
  { "Content-Type": "application/octet-stream" }
);
console.log(
  `Bundle uploadé : versionCode ${bundle.versionCode} (sha256 ${bundle.sha256.slice(0, 12)}…)`
);

for (const t of allTracks) {
  await api("PUT", `${base}/edits/${edit.id}/tracks/${t}`, {
    track: t,
    releases: [{ status, versionCodes: [String(bundle.versionCode)] }],
  });
}

// Tant que la fiche Play n'est pas complète, l'envoi en review est refusé →
// on committe alors sans review (la release reste visible dans Play Console).
async function commitEdit() {
  try {
    await api("POST", `${base}/edits/${edit.id}:commit`);
  } catch (e) {
    const msg = String(e.message);
    const declarationBlock =
      msg.includes("ReviewRequired") ||
      msg.includes("NotSentForReview") ||
      // Déclarations « Contenu de l'application » manquantes (intent plein
      // écran, photos/vidéos…) : Google bloque l'envoi en review tant que le
      // formulaire n'est pas rempli DANS LA CONSOLE — formulaire qui n'apparaît
      // souvent qu'APRÈS qu'un artefact portant la permission a atterri. Le
      // commit sans review casse ce cercle : la release arrive dans la console
      // et fait apparaître la déclaration à remplir.
      msg.includes("You must let us know");
    if (!declarationBlock) throw e;
    try {
      await api(
        "POST",
        `${base}/edits/${edit.id}:commit?changesNotSentForReview=true`
      );
      console.log(
        "(commit sans envoi en review — fiche Play incomplète, à finaliser dans la console)"
      );
    } catch (e2) {
      // Compte en « review automatique » : le paramètre est INTERDIT
      // (« must not be set »). Repli ultime VÉCU (26/07/2026, déclaration
      // intent plein écran) : reposer la release en BROUILLON — un brouillon
      // n'est pas envoyé en review, le commit passe, l'artefact atterrit dans
      // la console (ce qui fait justement APPARAÎTRE la déclaration à remplir)
      // et il ne restera qu'à publier depuis la console / relancer la CI.
      if (!String(e2.message).includes("must not be set")) throw e2;
      finalStatus = "draft";
      for (const t of allTracks) {
        await api("PUT", `${base}/edits/${edit.id}/tracks/${t}`, {
          track: t,
          releases: [
            { status: "draft", versionCodes: [String(bundle.versionCode)] },
          ],
        });
      }
      await api("POST", `${base}/edits/${edit.id}:commit`);
      console.log(
        "(déclaration console manquante → release posée en BROUILLON ; remplir la déclaration dans Play Console puis republier)"
      );
    }
  }
}

let finalStatus = status;
try {
  await commitEdit();
} catch (e) {
  // Appli jamais publiée (« draft app ») : Play n'accepte que des releases
  // brouillon → on repose la release en draft puis on recommitte.
  if (!String(e.message).includes("draft app")) throw e;
  finalStatus = "draft";
  for (const t of allTracks) {
    await api("PUT", `${base}/edits/${edit.id}/tracks/${t}`, {
      track: t,
      releases: [
        { status: "draft", versionCodes: [String(bundle.versionCode)] },
      ],
    });
  }
  await commitEdit();
  console.log(
    "(appli encore en brouillon → release posée en brouillon, à déployer depuis Play Console)"
  );
}

console.log(
  `OK — versionCode ${bundle.versionCode} (${finalStatus}) sur : ${allTracks.join(", ")}.`
);
