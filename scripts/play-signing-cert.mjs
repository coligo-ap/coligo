#!/usr/bin/env node
/**
 * Lit l'empreinte de la clé avec laquelle GOOGLE signe l'app distribuée sur Play.
 *
 *   npm run play:cert
 *
 * POURQUOI CE SCRIPT EXISTE
 * -------------------------
 * Play App Signing est OBLIGATOIRE pour toute app publiée en `.aab` : Google
 * resigne le bundle avec SA clé. L'APK que l'utilisateur installe ne porte donc
 * PAS l'empreinte de `coligo-release.keystore` (la clé d'upload), mais celle de
 * Google. Trois choses en dépendent, et se cassent en silence si l'on prend la
 * mauvaise :
 *
 *   • `public/.well-known/assetlinks.json` — sinon les App Links sont morts en
 *     production (Google refuse d'ouvrir coligo.app dans l'app) ;
 *   • le client OAuth Android (Sign-In Google natif) — sinon Credential Manager
 *     répond « Developer console is not set up correctly » ;
 *   • toute intégration qui vérifie la signature de l'app.
 *
 * On ne fait pas confiance à ce que dit la console : on télécharge l'APK que
 * Google distribue RÉELLEMENT et on lit son certificat. `certificateSha256Hash`
 * de l'API sert de contre-vérification.
 *
 * L'`edit` ouvert pour lister les pistes n'est JAMAIS commité : il est supprimé
 * dans un `finally`. Rien n'est publié.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JWT } from "google-auth-library";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = process.argv[2] ?? "app.coligo.client";
const KEY_FILE = join(ROOT, "play-service-account.json");

if (!existsSync(KEY_FILE)) {
  console.error("✖ play-service-account.json absent (secret, non versionné).");
  process.exit(1);
}

const key = JSON.parse(readFileSync(KEY_FILE, "utf8"));
const jwt = new JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ["https://www.googleapis.com/auth/androidpublisher"],
});
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const call = (url, init = {}) =>
  jwt.request({ url, ...init }).then((r) => r.data);

/** Le plus haut versionCode publié, toutes pistes confondues. */
async function latestVersionCode() {
  const edit = await call(`${base}/edits`, { method: "POST" });
  try {
    const { tracks = [] } = await call(`${base}/edits/${edit.id}/tracks`);
    const codes = tracks
      .flatMap((t) => t.releases ?? [])
      .flatMap((r) => r.versionCodes ?? [])
      .map(Number);
    if (!codes.length) throw new Error("aucun versionCode publié");
    return Math.max(...codes);
  } finally {
    // L'edit n'est jamais commité — on le referme quoi qu'il arrive.
    await call(`${base}/edits/${edit.id}`, { method: "DELETE" }).catch(
      () => {}
    );
  }
}

/** `apksigner` du build-tools le plus récent du SDK Android. */
function findApksigner() {
  const sdk =
    process.env.ANDROID_HOME ??
    process.env.ANDROID_SDK_ROOT ??
    join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
  const dir = join(sdk, "build-tools");
  if (!existsSync(dir)) return null;
  const versions = readdirSync(dir).sort();
  const last = versions[versions.length - 1];
  const exe = join(
    dir,
    last,
    process.platform === "win32" ? "apksigner.bat" : "apksigner"
  );
  return existsSync(exe) ? exe : null;
}

const versionCode = await latestVersionCode();
console.log(`package ${PACKAGE} · versionCode ${versionCode}\n`);

const [group] = (await call(`${base}/generatedApks/${versionCode}`))
  .generatedApks;
const apiSha256 = group.certificateSha256Hash;
console.log("Play App Signing — SHA-256 (API)   :", apiSha256);

const apk = join(tmpdir(), `${PACKAGE}-${versionCode}.apk`);
const res = await jwt.request({
  url: `${base}/generatedApks/${versionCode}/downloads/${group.generatedUniversalApk.downloadId}:download?alt=media`,
  responseType: "arraybuffer",
});
writeFileSync(apk, Buffer.from(res.data));

const apksigner = findApksigner();
if (!apksigner) {
  console.error("\n✖ apksigner introuvable — définir ANDROID_HOME.");
  process.exit(1);
}
// `shell: true` sous Windows : depuis Node 20, execFile refuse de lancer un
// `.bat` directement. `apksigner.bat` a besoin d'un JDK — celui d'Android Studio
// fait l'affaire si l'environnement n'en désigne aucun.
const JBR = "C:/Program Files/Android/Android Studio/jbr";
const out = execFileSync(apksigner, ["verify", "--print-certs", apk], {
  encoding: "utf8",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    JAVA_HOME:
      process.env.JAVA_HOME || (existsSync(JBR) ? JBR : "") || undefined,
  },
});
unlinkSync(apk);

/**
 * `apksigner` nomme la ligne selon le schéma de signature :
 *   "Signer #1 certificate SHA-1 digest: <hex>"     (v1/v2)
 *   "V3.0 Signer: certificate SHA-1 digest: <hex>"  (v3)
 * On EXCLUT le « Source Stamp Signer » : c'est une autre clé de Google, celle
 * qui atteste de l'origine Play, pas celle qui signe l'app.
 */
const digest = (algo) =>
  out
    .split("\n")
    .filter((l) => !/^Source Stamp/i.test(l))
    .map((l) =>
      new RegExp(`certificate ${algo} digest:\\s*([0-9a-f]+)`, "i").exec(l)
    )
    .find(Boolean)?.[1];

const sha1 = digest("SHA-1");
const sha256 = digest("SHA-256");
const fmt = (hex) => (hex ?? "").toUpperCase().match(/../g)?.join(":") ?? "?";

console.log("Play App Signing — SHA-256 (APK)   :", fmt(sha256));
console.log("Play App Signing — SHA-1  (APK)   :", fmt(sha1));

const coherent = fmt(sha256) === apiSha256;
console.log(
  "\nAPI et APK concordent :",
  coherent ? "oui" : "NON — à investiguer"
);

console.log(`
À reporter :
  • public/.well-known/assetlinks.json  → ${fmt(sha256)}
  • client OAuth Android (Google Cloud) → ${fmt(sha1)}   (package ${PACKAGE})
`);
process.exit(coherent ? 0 : 1);
