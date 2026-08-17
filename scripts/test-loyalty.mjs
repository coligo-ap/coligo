// =============================================================================
// Tests de non-régression — PROGRAMME DE FIDÉLITÉ (mig 0453/0454/0455)
// =============================================================================
// Vérifie, contre la VRAIE logique de prod (RPC + triggers Postgres) :
//   A. LOT & ACTIVATION — admin_loyalty_create_batch ; scan d'une carte d'un
//      lot `printed` JAMAIS distribué → activation au premier crédit (exigence
//      propriétaire) ; un lot volé ne vaut rien tant qu'aucun commerçant
//      authentifié n'a crédité.
//   B. CRÉDIT — cashback au taux du programme ; REJEU du même
//      client_operation_id (timeout réseau) → already:true, ZÉRO double crédit
//      (exigence propriétaire) ; plafond 24 h (clamp puis cap_reached).
//   C. CLOISONNEMENT — la FK composite rejette toute paire inter-commerçants ;
//      un crédit gagné chez A est invisible/inconsommable chez B.
//   D. PALIERS — bon débloqué au seuil, reste de progression conservé.
//   E. DÉDUCTION — bon (atomique, idempotent, une seule fois) + cashback
//      (insufficient au-delà du disponible).
//   F. LIAISON — transfert soldes+bons+progression vers le compte client,
//      bonus de liaison, carte déjà liée refusée à un autre compte.
//   G. PERTE — blocage (client/admin) + transfert admin vers carte de
//      remplacement ; carte bloquée rejetée proprement en caisse.
//   H. EXPIRATION — bon échu purgé (paresseux), valeur rendue au programme.
//   I. BORNES — config hors bornes refusée par la RPC ET par le trigger.
//   J. APPEND-ONLY + INTÉGRITÉ — UPDATE du ledger rejeté ;
//      integrity_violations() : zéro invariant fidélité violé.
//   K. KILL-SWITCH — flag `loyalty` ≠ active → crédit refusé (RPC + trigger).
// Tout s'exécute dans UNE transaction ROLLBACK (zéro pollution).
// Puis phase ANON (clé anon) : seule loyalty_card_public_peek répond.
// Usage : node scripts/test-loyalty.mjs
// =============================================================================

import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { getDbUrl, loadEnvLocal } from "./_supabase.mjs";

const client = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});

let failures = 0;
function assert(cond, label, detail) {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    failures++;
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const opId = (() => {
  let n = 0;
  return () => `test-loyalty-${Date.now()}-${++n}`;
})();

async function main() {
  await client.connect();

  // ── Fixtures : 2 commerçants actifs avec user auth, 1 client, 1 admin ────
  const mers = await client.query(
    `select id, user_id, name from merchants
      where is_active = true and user_id is not null
        and coalesce(is_frozen, false) = false
      order by created_at limit 2`
  );
  const cust = await client.query(
    `select id, user_id, full_name from customers
      where user_id is not null order by created_at limit 1`
  );
  const admin = await client.query(
    `select email from platform_admins
      where is_active and (role = 'owner' or 'commercants' = any(domains))
      limit 1`
  );
  if (mers.rows.length < 2 || !cust.rows[0] || !admin.rows[0]) {
    console.error(
      "Fixtures insuffisantes : 2 commerçants actifs (user_id), 1 client, 1 admin commercants."
    );
    process.exit(1);
  }
  const [MA, MB] = mers.rows; // commerçant A (programme), commerçant B (témoin)
  const CU = cust.rows[0];
  const adminEmail = admin.rows[0].email;

  const asAdmin = () =>
    client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ email: adminEmail, role: "authenticated" }),
    ]);
  const asUser = (userId) =>
    client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
  const j = async (sql, params) => (await client.query(sql, params)).rows[0].j;

  await client.query("BEGIN");
  try {
    // Programme actif le temps du test (tout est ROLLBACK à la fin).
    await client.query(
      "update feature_flags set status = 'active' where key = 'loyalty'"
    );
    await client.query(
      `update loyalty_platform_settings set
         min_earn_rate_pct = 0, max_earn_rate_pct = 20,
         min_tier_threshold_da = 500, max_tier_reward_da = 2000,
         max_daily_credit_cap_da = 5000, max_link_bonus_da = 500,
         min_voucher_validity_days = 7, max_voucher_validity_days = 365,
         max_purchase_per_credit_da = 100000, max_batch_quantity = 1000
       where id = 1`
    );
    // Nettoyage local : programme du commerçant A reconfiguré pour le test.
    await client.query("delete from loyalty_programs where merchant_id = $1", [
      MA.id,
    ]);

    // =========================================================================
    console.log("TEST I — bornes plateforme (config commerçant)");
    // =========================================================================
    await asUser(MA.user_id);
    let r = await j(
      `select public.merchant_update_loyalty_program(true, 50, 2000, 200, 90, 1000, 100) j`
    );
    assert(
      r.ok === false && r.error === "bounds_earn_rate",
      "I1 taux 50 % refusé (borne max 20 %)",
      JSON.stringify(r)
    );
    r = await j(
      `select public.merchant_update_loyalty_program(true, 5, 100, 200, 90, 1000, 100) j`
    );
    assert(
      r.ok === false && r.error === "bounds_tier_threshold",
      "I2 seuil 100 DA refusé (min 500)",
      JSON.stringify(r)
    );
    // Écriture DIRECTE hors bornes → le TRIGGER refuse (bypass-proof).
    let trigRejected = false;
    try {
      await client.query("SAVEPOINT bounds");
      await client.query(
        `insert into loyalty_programs (merchant_id, enabled, earn_rate_pct)
         values ($1, true, 99)`,
        [MA.id]
      );
    } catch (e) {
      trigRejected = String(e.message).includes("loyalty_bounds");
      await client.query("ROLLBACK TO SAVEPOINT bounds");
    }
    assert(
      trigRejected,
      "I3 insertion directe hors bornes rejetée par le trigger"
    );

    // Config valide : 5 % de cashback, palier 2000 DA → bon 200 DA,
    // validité 30 j, plafond 500 DA/24 h, bonus de liaison 100 DA.
    r = await j(
      `select public.merchant_update_loyalty_program(true, 5, 2000, 200, 30, 500, 100) j`
    );
    assert(r.ok === true, "I4 config valide acceptée", JSON.stringify(r));

    // =========================================================================
    console.log("TEST A — lot de cartes + activation au premier crédit");
    // =========================================================================
    await asAdmin();
    // Scénario « activation au premier crédit » : depuis 0460 le DÉFAUT est
    // pré-activé — on force explicitement p_activate_immediately => false.
    r = await j(
      `select public.admin_loyalty_create_batch(
         $1, 5, 'classic', 'lot de test',
         p_activate_immediately => false) j`,
      [MA.id]
    );
    assert(
      r.ok === true && r.quantity === 5,
      "A1 lot de 5 cartes créé",
      JSON.stringify(r)
    );
    const batchId = r.batch_id;
    const cards = (
      await client.query(
        `select id, card_code, status from loyalty_cards
          where batch_id = $1 order by created_at`,
        [batchId]
      )
    ).rows;
    assert(
      cards.length === 5 && cards.every((c) => c.status === "printed"),
      "A2 5 cartes pré-enregistrées `printed` (sans valeur)",
      JSON.stringify(cards.map((c) => c.status))
    );
    assert(
      cards.every((c) => /^[A-HJ-NP-Z2-9]{16}$/.test(c.card_code)) &&
        new Set(cards.map((c) => c.card_code)).size === 5,
      "A3 codes uniques, 16 car. Crockford (~80 bits)"
    );

    // 0459/0460 — nouveau DÉFAUT pré-activé + lot GÉNÉRIQUE sans commerçant.
    r = await j(
      `select public.admin_loyalty_create_batch($1, 2, 'classic', 'lot pré-activé') j`,
      [MA.id]
    );
    assert(
      r.ok === true && r.pre_activated === true,
      "A7 défaut 0460 : lot PRÉ-ACTIVÉ (utilisable sans compte ni app)",
      JSON.stringify(r)
    );
    const preCards = (
      await client.query(
        `select status, activated_at from loyalty_cards where batch_id = $1`,
        [r.batch_id]
      )
    ).rows;
    assert(
      preCards.length === 2 &&
        preCards.every((c) => c.status === "activated" && c.activated_at),
      "A8 cartes nées `activated` + horodatage + journal",
      JSON.stringify(preCards.map((c) => c.status))
    );
    r = await j(
      `select public.admin_loyalty_create_batch(NULL, 2, 'classic', 'lot générique') j`
    );
    assert(
      r.ok === true,
      "A9 lot GÉNÉRIQUE (sans commerçant) accepté",
      JSON.stringify(r)
    );
    const genCards = (
      await client.query(
        `select merchant_id from loyalty_cards where batch_id = $1`,
        [r.batch_id]
      )
    ).rows;
    assert(
      genCards.length === 2 && genCards.every((c) => c.merchant_id === null),
      "A10 cartes génériques : aucun commerçant rattaché",
      JSON.stringify(genCards)
    );

    // Carte d'un lot JAMAIS distribué, scannée telle quelle en caisse
    // (exigence propriétaire) : elle s'active au premier crédit.
    const C1 = cards[0]; // via URL de QR
    const C2 = cards[1]; // restera anonyme pour la suite
    const C3 = cards[2]; // pour la perte/remplacement
    const C4 = cards[3]; // carte de remplacement
    await asUser(MA.user_id);
    const opA = opId();
    r = await j(`select public.loyalty_credit($1, 2000, $2) j`, [
      `https://coligo.app/c/${C1.card_code}`,
      opA,
    ]);
    assert(
      r.ok === true &&
        r.activated === true &&
        r.earned_da === 100 &&
        r.vouchers_granted.length === 1,
      "A4 carte `printed` scannée (URL QR) → activée + crédit 5 % de 2000 = 100 + palier pile au seuil (bon 200)",
      JSON.stringify(r)
    );
    const c1Status = (
      await client.query(
        "select status, activated_at from loyalty_cards where id=$1",
        [C1.id]
      )
    ).rows[0];
    assert(
      c1Status.status === "activated" && c1Status.activated_at !== null,
      "A5 statut carte = activated + horodatage",
      JSON.stringify(c1Status)
    );
    const c1Events = (
      await client.query(
        `select from_status, to_status, actor from loyalty_card_events
          where card_id = $1 order by created_at`,
        [C1.id]
      )
    ).rows;
    assert(
      c1Events.some(
        (e) =>
          e.from_status === "printed" &&
          e.to_status === "activated" &&
          e.actor === "merchant"
      ),
      "A6 journal des cartes : printed→activated par le commerçant",
      JSON.stringify(c1Events)
    );

    // =========================================================================
    console.log("TEST B — rejeu d'opération + plafond 24 h");
    // =========================================================================
    // Rejeu du MÊME client_operation_id (timeout réseau côté caisse).
    r = await j(`select public.loyalty_credit($1, 2000, $2) j`, [
      C1.card_code,
      opA,
    ]);
    assert(
      r.ok === true && r.already === true,
      "B1 rejeu même opération → already:true (exigence propriétaire)",
      JSON.stringify(r)
    );
    const c1Credits = (
      await client.query(
        `select count(*)::int n, coalesce(sum(amount_da),0)::int s
           from loyalty_entries e
           join loyalty_accounts a on a.id = e.account_id
          where a.card_id = $1 and e.type = 'credit'`,
        [C1.id]
      )
    ).rows[0];
    assert(
      c1Credits.n === 1 && c1Credits.s === 100,
      "B2 un SEUL crédit en base après rejeu",
      JSON.stringify(c1Credits)
    );

    // Plafond 500 DA / 24 h : gros achat → clamp, puis refus.
    // Déjà consommé : 100 (crédit A4) + 200 (bon du palier A4) = 300.
    r = await j(`select public.loyalty_credit($1, 30000, $2) j`, [
      C1.card_code,
      opId(),
    ]);
    assert(
      r.ok === true && r.earned_da === 200 && r.capped === true,
      "B3 crédit clampé au plafond restant (500−300=200)",
      JSON.stringify(r)
    );
    r = await j(`select public.loyalty_credit($1, 1000, $2) j`, [
      C1.card_code,
      opId(),
    ]);
    assert(
      r.ok === false && r.error === "cap_reached",
      "B4 plafond atteint → cap_reached",
      JSON.stringify(r)
    );

    // =========================================================================
    console.log("TEST C — cloisonnement par contrainte SQL");
    // =========================================================================
    // C2 accumule chez A.
    const opC = opId();
    r = await j(`select public.loyalty_credit($1, 4000, $2) j`, [
      C2.card_code,
      opC,
    ]);
    assert(
      r.ok === true && r.earned_da === 200,
      "C1 carte 2 créditée chez A (200)",
      JSON.stringify(r)
    );

    // Chez B (aucun programme) : la fiche répond no_program, et une déduction
    // du solde gagné chez A est impossible.
    await asUser(MB.user_id);
    r = await j(`select public.loyalty_resolve_scan($1) j`, [C2.card_code]);
    assert(
      r.ok === false && r.error === "no_program",
      "C2 chez B sans programme : fiche refusée proprement",
      JSON.stringify(r)
    );
    await client.query(
      `insert into loyalty_programs (merchant_id, enabled, earn_rate_pct,
        voucher_validity_days, daily_credit_cap_da, link_bonus_da)
       values ($1, true, 2, 90, 1000, 0)
       on conflict (merchant_id) do update set enabled = true`,
      [MB.id]
    );
    r = await j(`select public.loyalty_resolve_scan($1) j`, [C2.card_code]);
    assert(
      r.ok === true && r.summary.balance_da === 0,
      "C3 fiche chez B : solde 0 (le crédit de A est invisible chez B)",
      JSON.stringify(r.summary)
    );
    r = await j(`select public.loyalty_redeem($1, $2, null, 100) j`, [
      C2.card_code,
      opId(),
    ]);
    assert(
      r.ok === false && r.error === "insufficient",
      "C4 déduction chez B du solde gagné chez A → échec attendu",
      JSON.stringify(r)
    );

    // Contrainte STRUCTURELLE : paire inter-commerçants rejetée par la FK.
    const accA = (
      await client.query(
        `select a.id from loyalty_accounts a
          where a.card_id = $1 and a.merchant_id = $2`,
        [C2.id, MA.id]
      )
    ).rows[0].id;
    const progB = (
      await client.query(`select public.loyalty_program_account($1) id`, [
        MB.id,
      ])
    ).rows[0].id;
    let fkRejected = false;
    try {
      await client.query("SAVEPOINT xmer");
      await client.query(
        `insert into loyalty_entries
           (account_id, merchant_id, counterparty_account_id, type, amount_da)
         values ($1, $2, $3, 'redeem', -50)`,
        [accA, MA.id, progB]
      );
    } catch (e) {
      fkRejected = String(e.message).includes("foreign key");
      await client.query("ROLLBACK TO SAVEPOINT xmer");
    }
    assert(
      fkRejected,
      "C5 paire inter-commerçants rejetée par la FK composite (contrainte SQL)"
    );

    // =========================================================================
    console.log("TEST D — paliers : bon débloqué, reste conservé");
    // =========================================================================
    await asUser(MA.user_id);
    // C2 a déjà 4000 de progression → 2 paliers de 2000 = 2 bons de 200 ?
    // Non : les bons comptent dans le plafond 24 h (500). 200 crédités + 2×200
    // de bons = 600 > 500 → le 2ᵉ bon est DIFFÉRÉ. Vérifions l'état réel.
    const c2Sum = await j(`select public.loyalty_resolve_scan($1) j`, [
      C2.card_code,
    ]);
    assert(
      c2Sum.summary.vouchers.length === 1 &&
        c2Sum.summary.vouchers[0].amount_da === 200,
      "D1 un bon de 200 débloqué au palier (le 2ᵉ différé par le plafond 24 h)",
      JSON.stringify(c2Sum.summary)
    );
    assert(
      c2Sum.summary.progress.spent_da === 2000 &&
        c2Sum.summary.progress.remaining_da === 0,
      "D2 progression restante conservée (2000/2000 — prête pour le bon différé)",
      JSON.stringify(c2Sum.summary.progress)
    );
    assert(
      c2Sum.summary.balance_da === 400 && c2Sum.summary.available_da === 200,
      "D3 solde 400 (200 cash + 200 bon), disponible hors bons 200",
      JSON.stringify(c2Sum.summary)
    );
    // Pour isoler la suite du plafond 24 h : cap relevé au max autorisé.
    r = await j(
      `select public.merchant_update_loyalty_program(true, 5, 2000, 200, 30, 5000, 100) j`
    );
    assert(r.ok === true, "D4 plafond 24 h relevé à 5000 pour la suite");

    // =========================================================================
    console.log("TEST E — déductions : bon + cashback, idempotence");
    // =========================================================================
    const voucherId = c2Sum.summary.vouchers[0].id;
    const opE = opId();
    r = await j(`select public.loyalty_redeem($1, $2, $3, null) j`, [
      C2.card_code,
      opE,
      voucherId,
    ]);
    assert(
      r.ok === true && r.deducted_da === 200,
      "E1 bon appliqué : déduction atomique de 200",
      JSON.stringify(r)
    );
    r = await j(`select public.loyalty_redeem($1, $2, $3, null) j`, [
      C2.card_code,
      opE,
      voucherId,
    ]);
    assert(
      r.ok === true && r.already === true,
      "E2 rejeu de la même déduction → already:true",
      JSON.stringify(r)
    );
    r = await j(`select public.loyalty_redeem($1, $2, $3, null) j`, [
      C2.card_code,
      opId(),
      voucherId,
    ]);
    assert(
      r.ok === false && r.error === "voucher_used",
      "E3 bon déjà utilisé → refus propre",
      JSON.stringify(r)
    );
    r = await j(`select public.loyalty_redeem($1, $2, null, 500) j`, [
      C2.card_code,
      opId(),
    ]);
    assert(
      r.ok === false && r.error === "insufficient" && r.available_da === 200,
      "E4 cashback au-delà du disponible → insufficient (200 dispo)",
      JSON.stringify(r)
    );
    r = await j(`select public.loyalty_redeem($1, $2, null, 150) j`, [
      C2.card_code,
      opId(),
    ]);
    assert(
      r.ok === true && r.deducted_da === 150 && r.summary.balance_da === 50,
      "E5 déduction cashback 150 → solde 50",
      JSON.stringify(r)
    );

    // =========================================================================
    console.log("TEST F — liaison : transfert + bonus, carte déjà liée");
    // =========================================================================
    // Le client de test peut déjà porter un solde RÉEL committé chez A
    // (verify-loyalty-prod-cycle) → toutes les assertions F sont en DELTA.
    const custBalanceOf = async () =>
      (
        await client.query(
          `select coalesce(sum(e.amount_da),0)::int s
             from loyalty_entries e
             join loyalty_accounts a on a.id = e.account_id
            where a.customer_id = $1 and a.owner_kind = 'customer'
              and a.merchant_id = $2`,
          [CU.id, MA.id]
        )
      ).rows[0].s;
    const custBal0 = await custBalanceOf();

    await asUser(CU.user_id);
    r = await j(`select public.loyalty_link_card($1, $2) j`, [
      C2.card_code,
      opId(),
    ]);
    assert(
      r.ok === true &&
        r.bonus_da === 100 &&
        Array.isArray(r.moved) &&
        r.moved.length === 1 &&
        r.moved[0].amount_da === 50,
      "F1 liaison : 50 DA transférés chez A + bonus 100",
      JSON.stringify(r)
    );
    const custBalance = await custBalanceOf();
    assert(
      custBalance - custBal0 === 150,
      "F2 compte client chez A : +150 (50 transférés + 100 bonus)",
      `delta=${custBalance - custBal0}`
    );
    const c2After = (
      await client.query(
        "select status, customer_id from loyalty_cards where id = $1",
        [C2.id]
      )
    ).rows[0];
    assert(
      c2After.status === "linked" && c2After.customer_id === CU.id,
      "F3 carte liée au compte",
      JSON.stringify(c2After)
    );
    // Un AUTRE compte ne peut pas lier la même carte.
    await asUser(MB.user_id); // MB.user n'est pas un customer → not_customer
    r = await j(`select public.loyalty_link_card($1) j`, [C2.card_code]);
    assert(
      r.ok === false,
      "F4 liaison par un non-client refusée",
      JSON.stringify(r)
    );
    // La carte liée scannée en caisse crédite désormais le COMPTE CLIENT.
    await asUser(MA.user_id);
    r = await j(`select public.loyalty_credit($1, 1000, $2) j`, [
      C2.card_code,
      opId(),
    ]);
    const custBalance2 = await custBalanceOf();
    // +50 de cashback + les paliers effectivement débloqués (la progression
    // importée par la liaison + l'historique RÉEL éventuel du compte rendent
    // le NOMBRE de bons variable — le DELTA, lui, est exact).
    const grantedSum = (r.vouchers_granted ?? []).reduce(
      (s, v) => s + v.amount_da,
      0
    );
    assert(
      r.ok === true &&
        r.earned_da === 50 &&
        custBalance2 - custBalance === 50 + grantedSum,
      "F5 crédit sur carte liée → compte client : +50 + paliers débloqués",
      `delta=${custBalance2 - custBalance} granted=${grantedSum}`
    );
    // Le prénom du porteur apparaît (carte liée), jamais le n° masqué seul.
    assert(
      r.label ===
        String(CU.full_name || "")
          .trim()
          .split(/\s+/)[0],
      "F6 fiche caisse : prénom du client lié",
      r.label
    );

    // =========================================================================
    console.log(
      "TEST G — perte : blocage + transfert vers carte de remplacement"
    );
    // =========================================================================
    // C3 anonyme accumule chez A puis est perdue.
    r = await j(`select public.loyalty_credit($1, 1000, $2) j`, [
      C3.card_code,
      opId(),
    ]);
    assert(r.ok === true && r.earned_da === 50, "G1 carte 3 créditée (50)");
    await asAdmin();
    r = await j(`select public.admin_loyalty_block_card($1, 'perdue') j`, [
      C3.id,
    ]);
    assert(r.ok === true, "G2 blocage admin", JSON.stringify(r));
    await asUser(MA.user_id);
    r = await j(`select public.loyalty_resolve_scan($1) j`, [C3.card_code]);
    assert(
      r.ok === false && r.error === "blocked",
      "G3 carte bloquée rejetée en caisse, sans détail technique",
      JSON.stringify(r)
    );
    await asAdmin();
    r = await j(
      `select public.admin_loyalty_transfer_card($1, $2, 'remplacement') j`,
      [C3.id, C4.card_code]
    );
    assert(
      r.ok === true && r.moved.length === 1 && r.moved[0].amount_da === 50,
      "G4 transfert admin vers carte de remplacement (50)",
      JSON.stringify(r)
    );
    const c4Status = (
      await client.query("select status from loyalty_cards where id=$1", [
        C4.id,
      ])
    ).rows[0].status;
    assert(
      c4Status === "activated",
      "G5 carte de remplacement activée",
      c4Status
    );
    await asUser(MA.user_id);
    r = await j(`select public.loyalty_resolve_scan($1) j`, [C4.card_code]);
    assert(
      r.ok === true && r.summary.balance_da === 50,
      "G6 solde consultable sur la carte de remplacement",
      JSON.stringify(r.summary)
    );

    // =========================================================================
    console.log("TEST H — expiration paresseuse d'un bon");
    // =========================================================================
    // Le client (compte lié) regagne un palier chez A : achat 4000 → bon 200
    // (progression précédente : 1000 de F5 + 2000 consommés… on lit l'état).
    r = await j(`select public.loyalty_credit($1, 8000, $2) j`, [
      C2.card_code,
      opId(),
    ]);
    assert(
      r.ok === true && r.vouchers_granted.length >= 1,
      "H1 nouveau bon débloqué sur le compte client",
      JSON.stringify(r)
    );
    const vExp = r.vouchers_granted[0].id;
    const balBeforeExp = r.summary.balance_da;
    await client.query(
      "update loyalty_vouchers set expires_at = now() - interval '1 day' where id = $1",
      [vExp]
    );
    r = await j(`select public.loyalty_resolve_scan($1) j`, [C2.card_code]);
    const vRow = (
      await client.query("select status from loyalty_vouchers where id=$1", [
        vExp,
      ])
    ).rows[0];
    assert(
      vRow.status === "expired" &&
        r.summary.balance_da === balBeforeExp - 200 &&
        !r.summary.vouchers.some((v) => v.id === vExp),
      "H2 bon échu purgé au scan suivant, valeur rendue au programme",
      `status=${vRow.status} bal=${r.summary.balance_da}`
    );

    // =========================================================================
    console.log("TEST M — Phase 2 : cas combiné commande + fidélité (un tap)");
    // =========================================================================
    const mkLoyaltyOrder = async (cid, net, pin, status = "pending") =>
      (
        await client.query(
          `insert into public.orders
             (merchant_id, customer_id, customer_name, customer_phone, status,
              payment_method, payment_status, pickup_type, pickup_slot_at,
              pickup_code, subtotal_da, total_da, net_total_da)
           values ($1, $2, 'TEST FID', '+213000000001', $5,
              'cash', 'pending', 'asap', now() + interval '30 min',
              $3, $4, $4, $4)
           returning id`,
          [MA.id, cid, pin, net, status]
        )
      ).rows[0].id;

    const mOrder = await mkLoyaltyOrder(CU.id, 2400, "TLY1");
    await client.query(
      "update public.orders set status='completed' where id=$1",
      [mOrder]
    );

    await asUser(MA.user_id);
    r = await j(`select public.loyalty_order_context($1) j`, [mOrder]);
    assert(
      r.ok === true &&
        r.customer === true &&
        r.can_credit === true &&
        r.credit_amount_da === 2400 &&
        r.already_credited === false,
      "M1 contexte commande : crédit un-tap proposé, montant repris (2400)",
      JSON.stringify(r)
    );

    const opM = opId();
    r = await j(`select public.loyalty_credit_order($1, $2) j`, [mOrder, opM]);
    assert(
      r.ok === true && r.earned_da === 120 && r.purchase_da === 2400,
      "M2 crédit un-tap : 5 % de 2400 = 120, zéro double saisie",
      JSON.stringify(r)
    );
    r = await j(`select public.loyalty_credit_order($1, $2) j`, [mOrder, opM]);
    assert(
      r.ok === true && r.already === true,
      "M3 rejeu même opération → already:true",
      JSON.stringify(r)
    );
    r = await j(`select public.loyalty_credit_order($1, $2) j`, [
      mOrder,
      opId(),
    ]);
    const mCredits = (
      await client.query(
        `select count(*)::int n, coalesce(sum(amount_da),0)::int s
           from loyalty_entries where order_id = $1 and type='credit' and amount_da > 0`,
        [mOrder]
      )
    ).rows[0];
    assert(
      r.ok === true &&
        r.already === true &&
        mCredits.n === 1 &&
        mCredits.s === 120,
      "M4 2ᵉ tentative (autre op) → UNE commande = UN crédit (index uq)",
      `r=${JSON.stringify(r)} credits=${JSON.stringify(mCredits)}`
    );
    r = await j(`select public.loyalty_order_context($1) j`, [mOrder]);
    assert(
      r.already_credited === true && r.can_credit === false,
      "M5 contexte après crédit : bouton un-tap retiré",
      JSON.stringify(r)
    );

    const opM6 = opId();
    r = await j(`select public.loyalty_redeem_order($1, $2, null, 50) j`, [
      mOrder,
      opM6,
    ]);
    assert(
      r.ok === true && r.deducted_da === 50,
      "M6 réduction à l'encaissement via la commande (50)",
      JSON.stringify(r)
    );
    r = await j(`select public.loyalty_redeem_order($1, $2, null, 50) j`, [
      mOrder,
      opM6,
    ]);
    assert(
      r.ok === true && r.already === true,
      "M7 rejeu de la réduction → already:true",
      JSON.stringify(r)
    );

    const guestOrder = await mkLoyaltyOrder(null, 1000, "TLY2");
    await client.query(
      "update public.orders set status='completed' where id=$1",
      [guestOrder]
    );
    r = await j(`select public.loyalty_order_context($1) j`, [guestOrder]);
    assert(
      r.ok === true && r.customer === false,
      "M8 commande invitée : pas de fidélité proposée",
      JSON.stringify(r)
    );
    r = await j(`select public.loyalty_credit_order($1, $2) j`, [
      guestOrder,
      opId(),
    ]);
    assert(
      r.ok === false && r.error === "no_customer",
      "M9 crédit refusé sur commande sans compte",
      JSON.stringify(r)
    );
    const pendingOrder = await mkLoyaltyOrder(CU.id, 1000, "TLY3");
    r = await j(`select public.loyalty_credit_order($1, $2) j`, [
      pendingOrder,
      opId(),
    ]);
    assert(
      r.ok === false && r.error === "order_not_completed",
      "M10 crédit refusé avant validation du retrait",
      JSON.stringify(r)
    );

    // =========================================================================
    console.log("TEST N — bon DIFFÉRÉ visible en caisse, posé au scan suivant");
    // =========================================================================
    // Plafond serré : le palier gagné dépasse le plafond du jour → différé.
    r = await j(
      `select public.merchant_update_loyalty_program(true, 5, 2000, 200, 30, 500, 100) j`
    );
    assert(r.ok === true, "N0 plafond resserré à 500 pour le scénario");
    const C5 = cards[4];
    r = await j(`select public.loyalty_credit($1, 8000, $2) j`, [
      C5.card_code,
      opId(),
    ]);
    assert(
      r.ok === true &&
        r.earned_da === 400 &&
        r.vouchers_granted.length === 0 &&
        r.voucher_deferred_da === 200,
      "N1 crédit : palier atteint mais plafond saturé → voucher_deferred_da VISIBLE",
      JSON.stringify(r)
    );
    r = await j(`select public.loyalty_resolve_scan($1) j`, [C5.card_code]);
    assert(
      r.ok === true &&
        r.voucher_deferred_da === 200 &&
        r.summary.vouchers.length === 0,
      "N2 fiche caisse : « Bon de 200 DA gagné — actif demain » affichable",
      JSON.stringify({ d: r.voucher_deferred_da, v: r.summary.vouchers })
    );
    // Le plafond se libère (ici : relevé) → le bon se POSE au simple scan,
    // sans nouvel achat — la promesse « actif demain » est tenue.
    r = await j(
      `select public.merchant_update_loyalty_program(true, 5, 2000, 200, 30, 5000, 100) j`
    );
    assert(r.ok === true, "N3 plafond libéré");
    r = await j(`select public.loyalty_resolve_scan($1) j`, [C5.card_code]);
    assert(
      r.ok === true &&
        r.summary.vouchers.length >= 1 &&
        r.voucher_deferred_da === 0,
      "N4 scan suivant : bon(s) posé(s) automatiquement, plus rien de différé",
      JSON.stringify({ d: r.voucher_deferred_da, v: r.summary.vouchers.length })
    );

    // =========================================================================
    console.log("TEST J — append-only + intégrité");
    // =========================================================================
    let updRejected = false;
    try {
      await client.query("SAVEPOINT immut");
      await client.query(
        "update loyalty_entries set amount_da = amount_da + 1 where account_id = $1",
        [accA]
      );
    } catch (e) {
      updRejected = String(e.message).includes("append-only");
      await client.query("ROLLBACK TO SAVEPOINT immut");
    }
    assert(
      updRejected,
      "J1 UPDATE du grand livre rejeté (append-only, mig 0243)"
    );

    const sums = (
      await client.query(
        `select merchant_id, sum(amount_da)::int s
           from loyalty_entries group by 1`
      )
    ).rows;
    assert(
      sums.every((x) => x.s === 0),
      "J2 SUM(grand livre fidélité) = 0 pour CHAQUE commerçant",
      JSON.stringify(sums)
    );

    const viol = (
      await client.query(
        "select code, cnt, detail from public.integrity_violations() where code like 'loyalty%'"
      )
    ).rows;
    assert(
      viol.length === 0,
      "J3 integrity_violations() : aucun invariant fidélité violé",
      JSON.stringify(viol)
    );

    // =========================================================================
    console.log("TEST K — kill-switch bypass-proof");
    // =========================================================================
    await client.query(
      "update feature_flags set status = 'hidden' where key = 'loyalty'"
    );
    r = await j(`select public.loyalty_credit($1, 1000, $2) j`, [
      C4.card_code,
      opId(),
    ]);
    assert(
      r.ok === false && r.error === "feature_disabled",
      "K1 flag hidden → crédit refusé proprement par la RPC",
      JSON.stringify(r)
    );
    let trgBlocked = false;
    try {
      await client.query("SAVEPOINT killswitch");
      await client.query(
        `insert into loyalty_entries
           (account_id, merchant_id, counterparty_account_id, type, amount_da)
         select a.id, a.merchant_id, public.loyalty_program_account(a.merchant_id), 'credit', 0
           from loyalty_accounts a where a.id = $1`,
        [accA]
      );
    } catch (e) {
      trgBlocked = String(e.message).includes("feature_disabled:loyalty");
      await client.query("ROLLBACK TO SAVEPOINT killswitch");
    }
    assert(
      trgBlocked,
      "K2 insertion directe bloquée par le trigger (bypass-proof)"
    );
    await client.query(
      "update feature_flags set status = 'active' where key = 'loyalty'"
    );

    // Vue client : le compte lié voit sa carte-magasin chez A.
    await asUser(CU.user_id);
    const ov = await j("select public.my_loyalty_overview() j");
    const accEntry = (ov.accounts || []).find((a) => a.merchant_id === MA.id);
    assert(
      !!accEntry && accEntry.summary.balance_da > 0,
      "K3 my_loyalty_overview : carte-magasin chez A avec solde",
      JSON.stringify(ov.accounts?.map((a) => a.merchant_name))
    );
    const hist = (
      await client.query("select * from public.my_loyalty_history(null, 50)")
    ).rows;
    assert(hist.length > 0, "K4 historique client non vide", hist.length);

    // Peek public (dans la transaction : carte anonyme C4 = 50 chez A).
    await client.query("select set_config('request.jwt.claims', '', true)");
    const peek = await j(`select public.loyalty_card_public_peek($1) j`, [
      C4.card_code,
    ]);
    assert(
      peek.ok === true &&
        peek.total_da === 50 &&
        Array.isArray(peek.balances) &&
        !JSON.stringify(peek).includes(String(CU.full_name).split(" ")[0]),
      "K5 landing publique : solde par magasin, AUCUNE donnée personnelle",
      JSON.stringify(peek)
    );
    const peekLinked = await j(`select public.loyalty_card_public_peek($1) j`, [
      C2.card_code,
    ]);
    assert(
      peekLinked.ok === true &&
        peekLinked.status === "linked" &&
        peekLinked.total_da === undefined &&
        peekLinked.balances === undefined,
      "K6 carte LIÉE : la landing ne montre ni solde ni identité",
      JSON.stringify(peekLinked)
    );

    // =========================================================================
    console.log("TEST O — cycle de vie du LOT entier (mig 0461)");
    // =========================================================================
    await asAdmin();
    r = await j(
      `select public.admin_loyalty_create_batch($1, 2, 'violet', 'lot cycle 0461') j`,
      [MA.id]
    );
    assert(
      r.ok === true,
      "O1 lot de 2 cartes pré-activées créé",
      JSON.stringify(r)
    );
    const oBatch = r.batch_id;
    r = await j(
      `select public.admin_loyalty_block_batch($1, 'série volée') j`,
      [oBatch]
    );
    assert(
      r.ok === true && r.blocked === 2,
      "O2 blocage du LOT : 2 cartes bloquées d'un coup",
      JSON.stringify(r)
    );
    let oRows = (
      await client.query(
        `select status from loyalty_cards where batch_id = $1`,
        [oBatch]
      )
    ).rows;
    assert(
      oRows.every((c) => c.status === "blocked"),
      "O3 toutes les cartes du lot sont `blocked`"
    );
    r = await j(`select public.admin_loyalty_unblock_batch($1) j`, [oBatch]);
    assert(
      r.ok === true && r.unblocked === 2,
      "O4 déblocage du LOT : 2 cartes restaurées",
      JSON.stringify(r)
    );
    oRows = (
      await client.query(
        `select status from loyalty_cards where batch_id = $1`,
        [oBatch]
      )
    ).rows;
    assert(
      oRows.every((c) => c.status === "activated"),
      "O5 état d'AVANT blocage restauré (activated)"
    );
    r = await j(
      `select public.admin_loyalty_delete_batch($1, 'fin de série') j`,
      [oBatch]
    );
    assert(
      r.ok === true && r.blocked === 2,
      "O6 suppression DOUCE : toutes les cartes désactivées",
      JSON.stringify(r)
    );
    const oBatchRow = (
      await client.query(
        `select deleted_at from loyalty_card_batches where id = $1`,
        [oBatch]
      )
    ).rows[0];
    assert(
      !!oBatchRow.deleted_at,
      "O7 lot marqué supprimé (deleted_at) — la ligne RESTE (traçabilité)"
    );
    r = await j(`select public.admin_loyalty_unblock_batch($1) j`, [oBatch]);
    assert(
      r.ok === false && r.reason === "deleted",
      "O8 lot supprimé : déblocage refusé",
      JSON.stringify(r)
    );
    const oJournal = (
      await client.query(
        `select * from public.admin_loyalty_batches(20, 'cycle 0461')`
      )
    ).rows;
    assert(
      oJournal.some(
        (b) => b.id === oBatch && b.deleted_at && b.has_custom_art === false
      ),
      "O9 journal : recherche par note + drapeaux 0461 (supprimé, design perso)",
      JSON.stringify(oJournal.map((b) => b.id))
    );
  } finally {
    await client.query("ROLLBACK");
  }
  await client.end();

  // ===========================================================================
  // Phase ANON — chaque RPC testée AVEC LA CLÉ ANON (règle du repo).
  // ===========================================================================
  console.log("TEST L — accès ANON aux RPC");
  loadEnvLocal();
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  {
    const { data, error } = await anon.rpc("loyalty_card_public_peek", {
      p_card_code: "AAAAAAAAAAAAAAAA",
    });
    assert(
      !error && data && data.ok === false && data.error === "not_found",
      "L1 loyalty_card_public_peek appelable en anon (not_found propre)",
      error?.message ?? JSON.stringify(data)
    );
  }
  for (const [fn, args] of [
    ["loyalty_resolve_scan", { p_identifier: "X" }],
    [
      "loyalty_credit",
      {
        p_identifier: "X",
        p_purchase_da: 1,
        p_client_operation_id: "aaaaaaaa",
      },
    ],
    [
      "loyalty_redeem",
      { p_identifier: "X", p_client_operation_id: "aaaaaaaa", p_amount_da: 1 },
    ],
    ["loyalty_link_card", { p_card_code: "X" }],
    ["my_loyalty_overview", {}],
    ["my_loyalty_history", {}],
    [
      "my_loyalty_block_card",
      { p_card_id: "00000000-0000-0000-0000-000000000000" },
    ],
    ["merchant_loyalty_state", {}],
    [
      "merchant_update_loyalty_program",
      {
        p_enabled: true,
        p_earn_rate_pct: 1,
        p_tier_threshold_da: null,
        p_tier_reward_da: null,
        p_voucher_validity_days: 30,
        p_daily_credit_cap_da: 100,
        p_link_bonus_da: 0,
      },
    ],
    ["admin_loyalty_settings", {}],
    [
      "admin_loyalty_create_batch",
      { p_merchant_id: "00000000-0000-0000-0000-000000000000", p_quantity: 1 },
    ],
    [
      "admin_loyalty_block_card",
      { p_card_id: "00000000-0000-0000-0000-000000000000" },
    ],
    [
      "admin_loyalty_unblock_card",
      { p_card_id: "00000000-0000-0000-0000-000000000000" },
    ],
    [
      "admin_loyalty_transfer_card",
      {
        p_from_card_id: "00000000-0000-0000-0000-000000000000",
        p_to_identifier: "X",
      },
    ],
    ["admin_loyalty_card_lookup", { p_query: "X" }],
    // Cycle de vie du LOT entier (mig 0461).
    [
      "admin_loyalty_block_batch",
      { p_batch_id: "00000000-0000-0000-0000-000000000000" },
    ],
    [
      "admin_loyalty_unblock_batch",
      { p_batch_id: "00000000-0000-0000-0000-000000000000" },
    ],
    [
      "admin_loyalty_delete_batch",
      { p_batch_id: "00000000-0000-0000-0000-000000000000" },
    ],
    [
      "loyalty_credit_order",
      {
        p_order_id: "00000000-0000-0000-0000-000000000000",
        p_client_operation_id: "aaaaaaaa",
      },
    ],
    [
      "loyalty_redeem_order",
      {
        p_order_id: "00000000-0000-0000-0000-000000000000",
        p_client_operation_id: "aaaaaaaa",
        p_amount_da: 1,
      },
    ],
    [
      "loyalty_order_context",
      { p_order_id: "00000000-0000-0000-0000-000000000000" },
    ],
    ["loyalty_expire_vouchers", {}],
    [
      "loyalty_program_account",
      { p_merchant: "00000000-0000-0000-0000-000000000000" },
    ],
    [
      "loyalty_account_balance",
      { p_account: "00000000-0000-0000-0000-000000000000" },
    ],
  ]) {
    const { error } = await anon.rpc(fn, args);
    assert(!!error, `L2 ${fn} REFUSÉE en anon`, "aurait dû être refusée");
  }

  console.log(
    failures === 0
      ? "\n✅ Tous les tests fidélité passent."
      : `\n❌ ${failures} échec(s).`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
