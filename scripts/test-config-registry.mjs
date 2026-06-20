// =============================================================================
// Test de l'éditeur de config générique (/admin/config) — persistance + historique.
// Vérifie : le registre mappe des colonnes réelles, l'écriture PERSISTE, et le
// trigger d'historique capture le diff. Transaction ROLLBACK.
//   node scripts/test-config-registry.mjs
// =============================================================================
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

let pass = 0,
  fail = 0;
const ok = (l, g, w) => {
  const p = g === w || String(g) === String(w);
  console.log(`${p ? "✅" : "❌"} ${l}: got=${g} want=${w}`);
  p ? pass++ : fail++;
};

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");

try {
  // 1) Chaque clé du registre correspond à une VRAIE colonne de platform_settings.
  const reg = (
    await c.query(
      "SELECT key, value_type FROM platform_config_registry WHERE is_active"
    )
  ).rows;
  ok("registre non vide", reg.length >= 13, true);
  const cols = new Set(
    (
      await c.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name='platform_settings'"
      )
    ).rows.map((r) => r.column_name)
  );
  const orphans = reg.filter((r) => !cols.has(r.key)).map((r) => r.key);
  ok(
    "toutes les clés mappent une colonne réelle (0 orpheline)",
    orphans.length,
    0
  );
  if (orphans.length) console.log("   orphelines:", orphans.join(", "));

  // 2) Exclusions respectées : p2p_enabled et base cashback NON dans le registre.
  ok(
    "p2p_enabled EXCLU du registre",
    reg.some((r) => r.key === "p2p_enabled"),
    false
  );

  // 3) Écriture d'une clé numérique → persiste + historique.
  const histBefore = (
    await c.query("SELECT count(*)::int n FROM platform_settings_history")
  ).rows[0].n;
  const oldDisc = (
    await c.query(
      "SELECT tour_discount_rate r FROM platform_settings WHERE id=true"
    )
  ).rows[0].r;
  await c.query(
    "UPDATE platform_settings SET tour_discount_rate = 0.33, updated_at = now() WHERE id = true"
  );
  const newDisc = (
    await c.query(
      "SELECT tour_discount_rate r FROM platform_settings WHERE id=true"
    )
  ).rows[0].r;
  ok("valeur numérique persistée", Number(newDisc), 0.33);
  const histAfter = (
    await c.query("SELECT count(*)::int n FROM platform_settings_history")
  ).rows[0].n;
  ok("ligne d'historique créée", histAfter - histBefore, 1);
  const last = (
    await c.query(
      "SELECT before_data, after_data FROM platform_settings_history ORDER BY changed_at DESC LIMIT 1"
    )
  ).rows[0];
  ok(
    "historique : before correct",
    Number(last.before_data.tour_discount_rate),
    Number(oldDisc)
  );
  ok(
    "historique : after correct",
    Number(last.after_data.tour_discount_rate),
    0.33
  );

  // 4) Écriture d'une clé JSON (paliers) → persiste.
  const tiers = [
    { up_to: 300, fee: 35 },
    { up_to: null, fee: 15 },
  ];
  await c.query(
    "UPDATE platform_settings SET service_fee_tiers = $1::jsonb WHERE id = true",
    [JSON.stringify(tiers)]
  );
  const got = (
    await c.query(
      "SELECT service_fee_tiers t FROM platform_settings WHERE id=true"
    )
  ).rows[0].t;
  ok("paliers JSON persistés (nb)", got.length, 2);
  ok("paliers JSON : 1er fee", got[0].fee, 35);

  // 5) Le moteur lit bien la nouvelle valeur (compute_service_fee_da via config).
  const sf = (await c.query("SELECT compute_service_fee_da(250) v")).rows[0].v;
  ok(
    "frais service recalculé sur la nouvelle config (panier 250 → palier 300 = 35)",
    sf,
    35
  );

  console.log(
    `\n${fail === 0 ? "🎉 CONFIG REGISTRY OK" : "⚠️ ÉCHECS"} — pass=${pass} fail=${fail}`
  );
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
process.exit(fail === 0 ? 0 : 1);
