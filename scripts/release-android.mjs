/**
 * RELEASE Android en UNE commande — bump + build + publication.
 *
 *   node scripts/release-android.mjs           # bump, build, → alpha + interne
 *   node scripts/release-android.mjs --prod    # + tente la PRODUCTION
 *   node scripts/release-android.mjs --no-bump # rebâtir la version courante
 *
 * Modèle « tests auto + prod sur tag » (choix proprio) : sans `--prod`, la
 * release ne va QUE sur les pistes de test (alpha + interne). Avec `--prod`,
 * on tente en plus la production — qui reste **verrouillée par Google** tant
 * que l'accès production n'est pas accordé (HTTP 400 FAILED_PRECONDITION) :
 * l'échec prod est alors signalé CLAIREMENT sans casser la publication de test.
 *
 * Pourquoi une commande locale et pas un CI sur push : l'app Android est un
 * shell Capacitor qui charge server.url (Vercel) — le web se met à jour tout
 * seul. Un nouveau binaire n'est nécessaire que sur un changement NATIF (rare).
 * La signature (keystore) et les secrets vivent sur cette machine ; les porter
 * en CI est possible plus tard (cf. RELEASING.md).
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { JWT } from "google-auth-library";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GRADLE = join(ROOT, "android", "app", "build.gradle");
const PACKAGE = "app.coligo.client";

const args = process.argv.slice(2);
const PROD = args.includes("--prod");
const NO_BUMP = args.includes("--no-bump");

function run(cmd, cmdArgs) {
  console.log(`\n▶ ${cmd} ${cmdArgs.join(" ")}`);
  const r = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    throw new Error(`échec: ${cmd} ${cmdArgs.join(" ")} (code ${r.status})`);
  }
}

/** versionCode client courant (sans bump). */
function readClientCode() {
  const block = readFileSync(GRADLE, "utf8").split("client {")[1] ?? "";
  return Number((block.match(/versionCode (\d+)/) || [])[1] ?? 0);
}

/** Tente de placer un bundle sur la PRODUCTION. Échec 400 = accès non accordé. */
async function tryProduction(versionCode) {
  const key = JSON.parse(
    readFileSync(resolve(ROOT, "play-service-account.json"), "utf8")
  );
  const jwt = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  const { token } = await jwt.getAccessToken();
  const h = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
  const edit = await (
    await fetch(`${base}/edits`, { method: "POST", headers: h })
  ).json();
  try {
    const put = await fetch(`${base}/edits/${edit.id}/tracks/production`, {
      method: "PUT",
      headers: h,
      body: JSON.stringify({
        track: "production",
        releases: [
          { status: "completed", versionCodes: [String(versionCode)] },
        ],
      }),
    });
    if (!put.ok) {
      const b = await put.json().catch(() => ({}));
      await fetch(`${base}/edits/${edit.id}`, { method: "DELETE", headers: h });
      if (put.status === 400) {
        console.warn(
          "\n⚠ PRODUCTION Google encore VERROUILLÉE (400 FAILED_PRECONDITION).\n" +
            "  L'accès production n'est pas accordé : test fermé 14 j / 12 testeurs\n" +
            "  puis « Demander l'accès à la production » dans la Play Console, +\n" +
            "  levée du rejet financial-services. La release TEST, elle, est publiée."
        );
        return false;
      }
      throw new Error(
        `production PUT ${put.status}: ${b?.error?.message ?? ""}`
      );
    }
    const commit = await fetch(`${base}/edits/${edit.id}:commit`, {
      method: "POST",
      headers: h,
    });
    if (!commit.ok) throw new Error(`commit production ${commit.status}`);
    console.log(`✅ PRODUCTION : versionCode ${versionCode} publié.`);
    return true;
  } catch (e) {
    await fetch(`${base}/edits/${edit.id}`, {
      method: "DELETE",
      headers: h,
    }).catch(() => {});
    throw e;
  }
}

async function main() {
  let versionCode;
  if (NO_BUMP) {
    versionCode = readClientCode();
  } else {
    // MÊME source que le CI Codemagic : versionCode = Play max + 1. Local et CI
    // ne se marchent JAMAIS dessus (plus de « version code already used »).
    run("node", ["scripts/ci-android-versioncode.mjs"]);
    versionCode = Number(
      readFileSync(join(ROOT, "android", ".ci-versioncode"), "utf8").trim()
    );
  }

  run("node", ["scripts/build-client-aab.mjs"]);
  // Toujours servir les pistes de TEST (doivent réussir).
  run("node", [
    "scripts/play-upload.mjs",
    "--track",
    "alpha",
    "--status",
    "completed",
    "--also",
    "internal",
  ]);
  console.log(`\n✅ Test : versionCode ${versionCode} sur alpha + interne.`);

  if (PROD) {
    await tryProduction(versionCode);
  } else {
    console.log(
      "\nℹ Production NON tentée (pas de --prod). Modèle « prod sur signal »."
    );
  }
}

main().catch((e) => {
  console.error("❌ release-android :", e.message);
  process.exit(1);
});
