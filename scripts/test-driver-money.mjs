/**
 * Test parité monétaire LIVREUR (cf. PROMPT-livreur-paiement §3).
 *
 * Valide que la config réelle de `platform_settings` + la formule produisent
 * EXACTEMENT les chiffres de référence du fondateur sur l'exemple :
 *   P=2000, commission 5 %=100, S=50, D=200
 *   → driver_fee=16, gain net=184, avance commerçant=1900,
 *     cash encaissé=2250, à reverser=166. (184+166=350 ✅)
 * Vérifie aussi que driver_outstanding / driver_can_accept répondent.
 *
 * Lecture seule (aucune écriture). Usage : `npm run test:driver:money`.
 */
import { getDbUrl } from "./_supabase.mjs";
import pg from "pg";

let failures = 0;
function assert(label, got, expected) {
  const ok = got === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "✅" : "❌"} ${label}: ${got}${ok ? "" : ` (attendu ${expected})`}`
  );
}

const c = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const { rows } = await c.query(
  "select driver_fee_rate::float8 r, driver_fee_cap_rate::float8 cap, driver_fee_min_da min_da, driver_float_cap_da cap_da from platform_settings where id=true"
);
const s = rows[0];

// Exemple de référence (commission 5 % validée pour le test).
const P = 2000,
  commissionRate = 0.05,
  S = 50,
  D = 200;
const commission = Math.round(P * commissionRate);
const driverFee = Math.min(
  D,
  Math.max(s.min_da, Math.min(Math.round(D * s.r), Math.round(D * s.cap)))
);
const driverNet = D - driverFee;
const cash = P + S + D; // cashback 0 sur COD
const advance = P - commission;
const owesPlatform = commission + S + driverFee;

assert("driver_fee", driverFee, 16);
assert("gain net livreur (D−fee)", driverNet, 184);
assert("avance commerçant (P−comm)", advance, 1900);
assert("cash encaissé client", cash, 2250);
assert("à reverser plateforme", owesPlatform, 166);
assert("cohérence 184+166=350", driverNet + owesPlatform, cash - advance);

// Fonctions DB.
const out = await c.query(
  "select public.driver_outstanding(gen_random_uuid()) o"
);
assert("driver_outstanding(inconnu)=0", Number(out.rows[0].o), 0);
const can = await c.query(
  "select public.driver_can_accept(gen_random_uuid()) v"
);
assert("driver_can_accept(inconnu)=true", can.rows[0].v, true);

await c.end();
console.log(failures === 0 ? "\nTOUT OK ✅" : `\n${failures} ÉCHEC(S) ❌`);
process.exit(failures === 0 ? 0 : 1);
