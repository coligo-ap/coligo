// =============================================================================
// Remplace les CAPTURES de la fiche App Store par le panorama généré —
// sur TOUTES les classes d'affichage iPhone ET iPad (demande du 19/08).
//
// Apple impose une séquence en TROIS temps par image — on ne peut pas juste
// « poster un fichier » :
//   1. RÉSERVER  : on annonce le nom et la taille, Apple renvoie les
//      opérations d'upload (URL + entêtes, parfois découpées en morceaux) ;
//   2. TÉLÉVERSER : on exécute chaque opération telle qu'Apple l'a décrite ;
//   3. CONFIRMER : on repasse `uploaded: true` avec l'empreinte MD5 — Apple
//      recalcule et refuse si ça ne correspond pas.
//
// ⚠️ CONTRAINTE APPLE : les captures ne se modifient que sur une version
// ÉDITABLE (PREPARE_FOR_SUBMISSION, WAITING_FOR_REVIEW…). Une version déjà
// EN LIGNE est verrouillée. Le script le vérifie et s'arrête proprement.
//
// Les jeux par classe sont pré-déclinés (même ratio = resize, ratio différent
// = blur-pad) dans store-assets/asc/<TYPE>/coligo_store_0X.png. Dans la
// console : « 6,9 » = APP_IPHONE_67, « 6,3 » = APP_IPHONE_61, iPad « 13 » =
// APP_IPAD_PRO_3GEN_129 — les classes API couvrent chaque ligne de l'UI.
//
// Lancer : node scripts/asc-screenshots.mjs [--create-version 1.0.1] [--dry]
// =============================================================================
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { asc as ascRaw } from "./_asc.mjs";

// Réseau instable (coupures socket vécues le 19/08) : chaque appel API est
// retenté 3× sur erreur RÉSEAU. Les orphelins d'une réservation dupliquée
// sont balayés par le delete-first de chaque jeu au run suivant.
async function asc(path, init) {
  for (let t = 0; ; t++) {
    try {
      return await ascRaw(path, init);
    } catch (e) {
      const network =
        e?.cause || /fetch failed|socket|timeout/i.test(String(e?.message));
      if (t >= 2 || !network) throw e;
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = "app.coligo.client";
const DISPLAYS = [
  "APP_IPHONE_67",
  "APP_IPHONE_65",
  "APP_IPHONE_61",
  "APP_IPHONE_58",
  "APP_IPHONE_55",
  "APP_IPHONE_47",
  "APP_IPHONE_40",
  "APP_IPHONE_35",
  "APP_IPAD_PRO_3GEN_129",
  "APP_IPAD_PRO_129",
  "APP_IPAD_PRO_3GEN_11",
  "APP_IPAD_105",
  "APP_IPAD_97",
];
const DRY = process.argv.includes("--dry");
const createIdx = process.argv.indexOf("--create-version");
const CREATE = createIdx > -1 ? process.argv[createIdx + 1] : null;

const shotsFor = (type) =>
  Array.from({ length: 7 }, (_, i) =>
    resolve(root, `store-assets/asc/${type}/coligo_store_0${i + 1}.jpg`)
  );
const missing = DISPLAYS.flatMap((t) => shotsFor(t)).filter(
  (p) => !existsSync(p)
);
if (missing.length) {
  console.error("Captures manquantes :", missing.slice(0, 5).join(", "));
  process.exit(1);
}

// ── Application + version éditable ────────────────────────────────────────
const apps = await asc(`/apps?filter[bundleId]=${BUNDLE}`);
const app = apps.data?.[0];
if (!app) {
  console.error("Application introuvable pour", BUNDLE);
  process.exit(1);
}
console.log(`App : ${app.attributes.name} (${app.id})`);

const EDITABLE = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "WAITING_FOR_REVIEW",
  "INVALID_BINARY",
]);

const versions = await asc(`/apps/${app.id}/appStoreVersions?limit=10`);
let version = (versions.data ?? []).find((v) =>
  EDITABLE.has(v.attributes.appStoreState)
);

if (!version && CREATE) {
  console.log(`Aucune version éditable — création de la ${CREATE}…`);
  const created = await asc("/appStoreVersions", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "appStoreVersions",
        attributes: { platform: "IOS", versionString: CREATE },
        relationships: { app: { data: { type: "apps", id: app.id } } },
      },
    }),
  });
  version = created.data;
  console.log(`Version ${CREATE} créée (${version.id}).`);
}

if (!version) {
  console.error(
    "Aucune version ÉDITABLE. Apple verrouille les captures d'une version en ligne.\n" +
      "Relancez avec --create-version 1.0.1 pour en ouvrir une."
  );
  process.exit(2);
}
console.log(
  `Version cible : ${version.attributes.versionString} (${version.attributes.appStoreState})`
);

// ── Une langue = un jeu de captures PAR classe d'affichage ────────────────
const locs = await asc(
  `/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=20`
);
console.log(
  "Langues :",
  (locs.data ?? []).map((l) => l.attributes.locale).join(", ") || "aucune"
);

if (DRY) {
  console.log("Essai à blanc — rien n'a été modifié.");
  process.exit(0);
}

for (const loc of locs.data ?? []) {
  const locale = loc.attributes.locale;
  console.log(`
── ${locale} ──`);

  const sets = await asc(
    `/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=50`
  );

  const doDisplay = async (displayType) => {
    // Jeu de captures pour ce gabarit (créé au besoin).
    let set = (sets.data ?? []).find(
      (s) => s.attributes.screenshotDisplayType === displayType
    );
    if (!set) {
      const made = await asc("/appScreenshotSets", {
        method: "POST",
        body: JSON.stringify({
          data: {
            type: "appScreenshotSets",
            attributes: { screenshotDisplayType: displayType },
            relationships: {
              appStoreVersionLocalization: {
                data: { type: "appStoreVersionLocalizations", id: loc.id },
              },
            },
          },
        }),
      });
      set = made.data;
    }

    // REPRISE : un jeu déjà complet en .jpg (run précédent) est sauté.
    const olds = await asc(
      `/appScreenshotSets/${set.id}/appScreenshots?limit=20`
    );
    const files = (olds.data ?? []).map((o) => o.attributes.fileName ?? "");
    const done =
      files.length === 7 &&
      files.every((f) => f.endsWith(".jpg")) &&
      (olds.data ?? []).every(
        (o) => o.attributes.assetDeliveryState?.state === "COMPLETE"
      );
    if (done) {
      console.log(`  ${displayType} : déjà complet — sauté`);
      return;
    }
    for (const o of olds.data ?? []) {
      await asc(`/appScreenshots/${o.id}`, { method: "DELETE" });
    }

    // Envoi des 7, dans l'ordre (séquentiel à l intérieur de la classe).
    for (const [i, file] of shotsFor(displayType).entries()) {
      const bytes = readFileSync(file);
      const fileName = `coligo_store_0${i + 1}.jpg`;

      const reserved = await asc("/appScreenshots", {
        method: "POST",
        body: JSON.stringify({
          data: {
            type: "appScreenshots",
            attributes: { fileSize: bytes.length, fileName },
            relationships: {
              appScreenshotSet: {
                data: { type: "appScreenshotSets", id: set.id },
              },
            },
          },
        }),
      });
      const shot = reserved.data;

      for (const op of shot.attributes.uploadOperations ?? []) {
        const chunk = bytes.subarray(op.offset, op.offset + op.length);
        const headers = Object.fromEntries(
          (op.requestHeaders ?? []).map((h) => [h.name, h.value])
        );
        let ok = false;
        for (let t = 0; t < 3 && !ok; t++) {
          try {
            const put = await fetch(op.url, {
              method: op.method,
              headers,
              body: chunk,
            });
            if (put.ok) ok = true;
            else if (t === 2)
              throw new Error(`upload ${fileName} : HTTP ${put.status}`);
          } catch (e) {
            if (t === 2) throw e;
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
      }

      const md5 = createHash("md5").update(bytes).digest("hex");
      await asc(`/appScreenshots/${shot.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          data: {
            type: "appScreenshots",
            id: shot.id,
            attributes: { uploaded: true, sourceFileChecksum: md5 },
          },
        }),
      });
    }
    console.log(`  ${displayType} : 7 volets ✓`);
  };

  // Les 13 classes EN PARALLÈLE (réseau lent : sérialiser = des heures).
  const results = await Promise.allSettled(DISPLAYS.map(doDisplay));
  const fails = results.filter((r) => r.status === "rejected");
  for (const f of fails)
    console.error("  échec :", String(f.reason).slice(0, 160));
  if (fails.length) process.exitCode = 1;
}

console.log(
  "\n✅ Captures remplacées sur toutes les classes iPhone + iPad. Elles " +
    "seront PUBLIQUES à l'approbation de la version."
);
