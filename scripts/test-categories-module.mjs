// Test e2e du module Catégories admin (mig 0311-0319 + 0336 + 0339) :
//  1. FIX reclassement : admin_reorder_categories (UPDATE only — l'ancien
//     upsert PostgREST explosait en NOT NULL sur `label`) — ordre appliqué,
//     restauré, refus des listes périmées/doublons, labels intacts.
//  2. Anti-perte de données : suppression refusée tant qu'une liaison existe.
//  3. Cycle vie complet sur une CATÉGORIE TEMPORAIRE : création → liaison
//     manuelle d'un commerçant → listing → détachement → suppression.
//  4. Cohérence primaire : chaque merchants.category a sa liaison 'primary'
//     et aucune liaison 'primary' ne diverge (invariant mig 0319).
//  5. Accès : la RPC de reclassement est service_role SEULEMENT (anon rejeté).
//
// Aucune donnée réelle modifiée : l'ordre est restauré, la catégorie temporaire
// supprimée. Lancement : node scripts/test-categories-module.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(ROOT, ".env.local"), "utf8");
const get = (k) => {
  const m = env.match(new RegExp("^\\s*" + k + "\\s*=\\s*(.*)\\s*$", "m"));
  let v = m ? m[1] : "";
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  )
    v = v.slice(1, -1);
  return v;
};
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

let failures = 0;
const check = (label, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
};

const snapshot = async () => {
  const { data } = await admin
    .from("merchant_categories")
    .select("code, label, position")
    .order("position", { ascending: true });
  return data ?? [];
};

const TMP_CODE = "test_e2e_tmp_cat";

try {
  // ── 1. Reclassement ────────────────────────────────────────────────────
  const before = await snapshot();
  check(
    "état initial : labels tous non nuls",
    before.every((r) => !!r.label)
  );

  const codes = before.map((r) => r.code);
  const swapped = [...codes];
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];

  const { data: r1, error: e1 } = await admin.rpc("admin_reorder_categories", {
    p_codes: swapped,
  });
  check("reorder (échange 1↔2) accepté", !e1 && r1 === "ok", e1?.message);

  const after = await snapshot();
  check(
    "ordre appliqué",
    JSON.stringify(after.map((r) => r.code)) === JSON.stringify(swapped)
  );
  check(
    "labels INTACTS après reorder (bug NOT NULL corrigé)",
    after.every((r) => !!r.label)
  );

  // Restauration de l'ordre réel.
  const { data: r2 } = await admin.rpc("admin_reorder_categories", {
    p_codes: codes,
  });
  const restored = await snapshot();
  check(
    "ordre restauré à l'identique (aucune perte)",
    r2 === "ok" &&
      JSON.stringify(restored.map((r) => r.code)) === JSON.stringify(codes)
  );

  // Refus des listes invalides — positions inchangées à chaque fois.
  const { data: stale1 } = await admin.rpc("admin_reorder_categories", {
    p_codes: codes.slice(1),
  });
  check("liste partielle refusée (stale)", stale1 === "stale");
  const { data: stale2 } = await admin.rpc("admin_reorder_categories", {
    p_codes: [...codes.slice(1), codes[1]],
  });
  check("doublon refusé (stale)", stale2 === "stale");
  const { data: stale3 } = await admin.rpc("admin_reorder_categories", {
    p_codes: [...codes, "code_inconnu_xyz"],
  });
  check("code inconnu refusé (stale)", stale3 === "stale");
  const untouched = await snapshot();
  check(
    "positions inchangées après les refus",
    JSON.stringify(untouched) === JSON.stringify(restored)
  );

  // anon → permission denied (REVOKE).
  const anonC = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: anonErr } = await anonC.rpc("admin_reorder_categories", {
    p_codes: codes,
  });
  check(
    "anon rejeté sur la RPC de reclassement",
    !!anonErr && /permission denied/i.test(anonErr.message),
    anonErr?.message
  );

  // ── 2-3. Cycle de vie catégorie temporaire + gardes suppression ───────
  await admin.from("merchant_categories").delete().eq("code", TMP_CODE); // idempotence
  const { error: insErr } = await admin.from("merchant_categories").insert({
    code: TMP_CODE,
    label: "Test E2E (temp)",
    label_ar: "اختبار مؤقت",
    emoji: "🧪",
    position: 99990,
    kind: "type",
  });
  check("création catégorie temporaire", !insErr, insErr?.message);

  const { data: anyMerchant } = await admin
    .from("merchants")
    .select("id, name, category")
    .limit(1)
    .maybeSingle();
  check("un commerçant existe pour le test", !!anyMerchant);

  if (anyMerchant) {
    const { error: linkErr } = await admin
      .from("merchant_category_links")
      .insert({
        merchant_id: anyMerchant.id,
        code: TMP_CODE,
        source: "manual",
      });
    check("liaison manuelle ajoutée", !linkErr, linkErr?.message);

    const { data: linked } = await admin
      .from("merchant_category_links")
      .select("merchant_id, source")
      .eq("code", TMP_CODE);
    check(
      "listing : le commerçant apparaît lié (manuel)",
      (linked ?? []).some(
        (l) => l.merchant_id === anyMerchant.id && l.source === "manual"
      )
    );

    // Suppression REFUSÉE tant que la liaison existe (anti-perte de données).
    const { data: delBlocked } = await admin.rpc("admin_delete_category", {
      p_code: TMP_CODE,
    });
    check(
      "suppression refusée avec liaison (links:1)",
      delBlocked === "links:1",
      String(delBlocked)
    );

    // Détachement puis suppression OK.
    await admin
      .from("merchant_category_links")
      .delete()
      .eq("code", TMP_CODE)
      .eq("merchant_id", anyMerchant.id);
    const { data: delOk } = await admin.rpc("admin_delete_category", {
      p_code: TMP_CODE,
    });
    check("suppression OK une fois détachée", delOk === "ok", String(delOk));
  }

  // Le set a changé (catégorie temp créée/supprimée) : un reorder resté sur
  // l'ANCIENNE liste pendant la création aurait été refusé — c'est le contrat.

  // ── 4. Invariant primaire (cohérence comptages / garde suppression) ───
  const { data: merchs } = await admin
    .from("merchants")
    .select("id, category")
    .not("category", "is", null);
  const { data: primLinks } = await admin
    .from("merchant_category_links")
    .select("merchant_id, code, source")
    .eq("source", "primary");
  const primByMerchant = new Map(
    (primLinks ?? []).map((l) => [l.merchant_id, l.code])
  );
  const missing = (merchs ?? []).filter(
    (m) => primByMerchant.get(m.id) !== m.category
  );
  const orphans = (primLinks ?? []).filter((l) => {
    const m = (merchs ?? []).find((x) => x.id === l.merchant_id);
    return !m || m.category !== l.code;
  });
  check(
    "chaque catégorie principale a sa liaison 'primary'",
    missing.length === 0,
    missing.length ? `${missing.length} manquantes` : ""
  );
  check(
    "aucune liaison 'primary' divergente",
    orphans.length === 0,
    orphans.length ? `${orphans.length} orphelines` : ""
  );
} finally {
  await admin.from("merchant_categories").delete().eq("code", TMP_CODE);
  console.log(
    failures === 0
      ? "--- TOUT VERT — nettoyage OK ---"
      : `--- ${failures} ÉCHEC(S) — nettoyage OK ---`
  );
  if (failures > 0) process.exitCode = 1;
}
