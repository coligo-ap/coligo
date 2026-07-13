// =============================================================================
// Test du SOCLE IDV (mig 0367) — vérification d'identité automatisée.
// 1) Moteur de décision pur (lib/idv/decision.ts) : seuils, policy, escalade.
// 2) DB : seeds, kill-switch, bucket privé, index « un dossier actif »,
//    journal d'audit append-only, RLS (config lisible / colonnes de seuils et
//    tables sensibles INTERDITES à `authenticated`).
// Transaction ROLLBACK : ne laisse aucune trace.
//   node --experimental-strip-types scripts/test-idv-core.mjs
// =============================================================================
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";
import { decideIdv } from "../lib/idv/decision.ts";

let pass = 0,
  fail = 0;
const ok = (l, g, w) => {
  const p = g === w || String(g) === String(w);
  console.log(`${p ? "✅" : "❌"} ${l}: got=${g} want=${w}`);
  p ? pass++ : fail++;
};

// ── 1) Moteur de décision (pur, sans DB) ────────────────────────────────────
const T = {
  face_match_approve: 0.6,
  face_match_reject: 0.35,
  liveness_min: 0.7,
  doc_confidence_min: 0.6,
};
const d = (input) => decideIdv({ thresholds: T, ...input });

ok(
  "tout bon → approve",
  d({ scores: { face_match: 0.8, liveness: 0.9, doc_confidence: 0.9 } })
    .outcome,
  "approve"
);
ok(
  "face intermédiaire → review",
  d({ scores: { face_match: 0.5, liveness: 0.9, doc_confidence: 0.9 } })
    .outcome,
  "review"
);
ok(
  "face faible → reject",
  d({ scores: { face_match: 0.2, liveness: 0.9, doc_confidence: 0.9 } })
    .outcome,
  "reject"
);
ok(
  "face absent → review (jamais d'auto-décision sans face match)",
  d({ scores: { liveness: 0.9, doc_confidence: 0.9 } }).outcome,
  "review"
);
ok(
  "liveness bas, policy par défaut → review",
  d({ scores: { face_match: 0.8, liveness: 0.4, doc_confidence: 0.9 } })
    .outcome,
  "review"
);
ok(
  "liveness bas, policy reject → reject",
  d({
    policy: { liveness_fail: "reject" },
    scores: { face_match: 0.8, liveness: 0.4, doc_confidence: 0.9 },
  }).outcome,
  "reject"
);
ok(
  "liveness exigé mais absent → review",
  d({
    livenessRequired: true,
    scores: { face_match: 0.8, doc_confidence: 0.9 },
  }).outcome,
  "review"
);
ok(
  "document expiré → reject (policy par défaut)",
  d({
    documentExpired: true,
    scores: { face_match: 0.8, liveness: 0.9, doc_confidence: 0.9 },
  }).outcome,
  "reject"
);
ok(
  "contrôle en ERREUR technique → review, jamais reject",
  d({
    checks: [{ key: "mrz", status: "error" }],
    scores: { face_match: 0.8, liveness: 0.9, doc_confidence: 0.9 },
  }).outcome,
  "review"
);
ok(
  "contrôle failed + policy check_failed=reject → reject",
  d({
    policy: { check_failed: "reject" },
    checks: [{ key: "doc_authenticity", status: "failed" }],
    scores: { face_match: 0.8, liveness: 0.9, doc_confidence: 0.9 },
  }).outcome,
  "reject"
);
{
  const r = d({
    documentExpired: true,
    scores: { face_match: 0.5, liveness: 0.4, doc_confidence: 0.9 },
  });
  ok(
    "les raisons S'ACCUMULENT (expiré + liveness + face incertain)",
    r.reasons.length >= 3 && r.outcome === "reject",
    true
  );
}
ok(
  "aucune anomalie → raison all_checks_passed",
  d({ scores: { face_match: 0.9, liveness: 0.9, doc_confidence: 0.9 } })
    .reasons[0],
  "all_checks_passed"
);

// ── 2) DB : socle mig 0367 ──────────────────────────────────────────────────
const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");

/** Exécute une requête censée ÉCHOUER (savepoint → la txn continue). */
async function expectError(label, sql, params = []) {
  await c.query("SAVEPOINT sp");
  try {
    await c.query(sql, params);
    ok(label, "aucune-erreur", "erreur-attendue");
    await c.query("RELEASE SAVEPOINT sp");
  } catch {
    ok(label, "erreur", "erreur");
    await c.query("ROLLBACK TO SAVEPOINT sp");
  }
}

try {
  // Seeds + kill-switch.
  const modes = (
    await c.query("SELECT key FROM idv_modes ORDER BY position")
  ).rows.map((r) => r.key);
  ok("2 modes seedés (express, standard)", modes.join(","), "express,standard");
  const docs = await c.query("SELECT count(*)::int n FROM idv_document_types");
  ok("3 types de documents DZ", docs.rows[0].n, 3);
  const rules = await c.query(
    "SELECT count(*)::int n FROM idv_profile_rules WHERE requirement = 'disabled'"
  );
  ok("3 profils seedés, tous DÉSACTIVÉS", rules.rows[0].n, 3);
  const flag = await c.query(
    "SELECT status FROM feature_flags WHERE key = 'identity_verification'"
  );
  ok(
    "flag identity_verification = hidden (non publié)",
    flag.rows[0]?.status,
    "hidden"
  );
  const bucket = await c.query(
    "SELECT public FROM storage.buckets WHERE id = 'idv-captures'"
  );
  ok("bucket idv-captures privé", bucket.rows[0]?.public, false);
  const pols = await c.query(
    "SELECT count(*)::int n FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND qual ILIKE '%idv-captures%'"
  );
  ok(
    "0 policy storage sur idv-captures (service_role only)",
    pols.rows[0].n,
    0
  );

  // Un seul dossier actif par (user, profil).
  const anyUser = await c.query("SELECT id FROM auth.users LIMIT 1");
  if (anyUser.rows.length) {
    const uid = anyUser.rows[0].id;
    await c.query(
      "INSERT INTO idv_verifications (user_id, profile, mode) VALUES ($1, 'driver', 'standard')",
      [uid]
    );
    await expectError(
      "2e dossier actif même (user, profil) → refusé (index partiel)",
      "INSERT INTO idv_verifications (user_id, profile, mode) VALUES ($1, 'driver', 'express')",
      [uid]
    );
  } else {
    console.log("⚠️ aucun auth.users — test index unique sauté");
  }

  // Journal d'audit append-only.
  const audit = await c.query(
    "INSERT INTO idv_audit_log (actor_type, action) VALUES ('system', 'test') RETURNING id"
  );
  const auditId = audit.rows[0].id;
  await expectError(
    "audit : UPDATE interdit (append-only)",
    "UPDATE idv_audit_log SET reason = 'x' WHERE id = $1",
    [auditId]
  );
  await expectError(
    "audit : DELETE interdit (append-only)",
    "DELETE FROM idv_audit_log WHERE id = $1",
    [auditId]
  );

  // RLS vue « authenticated ».
  await c.query("SET LOCAL ROLE authenticated");
  await c.query(
    `SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true)`
  );
  const pubModes = await c.query(
    "SELECT key, label_fr, max_attempts FROM idv_modes ORDER BY position"
  );
  ok(
    "authenticated lit les modes (colonnes publiques)",
    pubModes.rows.length,
    2
  );
  const pubRules = await c.query(
    "SELECT profile, requirement FROM idv_profile_rules"
  );
  ok("authenticated lit les règles par profil", pubRules.rows.length, 3);
  await expectError(
    "authenticated NE lit PAS les seuils (face_match_approve)",
    "SELECT face_match_approve FROM idv_modes"
  );
  await expectError(
    "authenticated NE lit PAS idv_verifications",
    "SELECT id FROM idv_verifications"
  );
  await expectError(
    "authenticated NE lit PAS le journal d'audit",
    "SELECT id FROM idv_audit_log"
  );
  await expectError(
    "authenticated N'écrit PAS les règles",
    "UPDATE idv_profile_rules SET requirement = 'required' WHERE profile = 'driver'"
  );
  await c.query("RESET ROLE");
} finally {
  await c.query("ROLLBACK");
  await c.end();
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} OK / ${fail} KO`);
process.exit(fail === 0 ? 0 : 1);
