// =============================================================================
// Test A→Z « Agent Coligo Pay » : auto-inscription + validation + revente.
// =============================================================================
// Tout se joue dans UNE transaction puis ROLLBACK (rien persisté en prod).
// On simule l'auth (auth.uid) via set_config('request.jwt.claims') + role
// authenticated, exactement comme test-coligo-pay.mjs.
//
// Couvre : résolution du portefeuille, lecture de SON dossier (getCurrentPartner),
// dépôt de pièces + garde de chemin, INERTIE du compte pending (vente refusée,
// invisible au public), anti-auto-activation (RLS), anti-doublon, validation
// admin → activation, revente (double-entrée=0, idempotence, solde insuffisant,
// mauvais PIN, anti self-target), visibilité après activation, isolation des
// pièces entre comptes.
//
//   node scripts/test-agent-signup.mjs   (ou: npm run test:agent)
// =============================================================================

import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

let failures = 0;
function check(label, cond, extra = "") {
  const ok = !!cond;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? "  — " + extra : ""}`);
  if (!ok) failures++;
}

const c = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await c.connect();
  const one = async (sql, p = []) => (await c.query(sql, p)).rows[0];
  const asUser = (u) =>
    c.query(
      "select set_config('request.jwt.claims', json_build_object('sub',$1::text)::text, true)",
      [u]
    );

  // Vérifie qu'un appel SQL lève une erreur contenant `frag` (savepoint pour ne
  // pas avorter la transaction).
  async function expectError(label, sql, params, frag) {
    await c.query("savepoint sp");
    try {
      await c.query(sql, params);
      check(label, false, "aucune erreur levée");
      await c.query("release savepoint sp");
    } catch (e) {
      const ok =
        String(e.message).toLowerCase().includes(frag.toLowerCase()) ||
        (frag === "duplicate" && e.code === "23505");
      check(label, ok, ok ? "" : `err inattendue: ${e.message}`);
      await c.query("rollback to savepoint sp");
    }
  }

  try {
    await c.query("BEGIN");

    const agentUid = (await one("select gen_random_uuid() id")).id;
    const otherUid = (await one("select gen_random_uuid() id")).id;
    const buyerUid = (await one("select gen_random_uuid() id")).id;
    const NAME = "E2E_AGENT_" + Date.now();

    // ── SETUP (rôle postgres = bypass RLS) : auto-inscription = wallet pending.
    const agentWallet = (
      await one(
        `insert into operator_wallets
           (owner_type, owner_id, is_partner, status, is_verified, display_name,
            owner_name, registre_commerce, phone, wilaya, commune, address, lat, lng, submitted_at)
         values ('partner',$1,true,'pending',false,$2,'Gérant Test','RC-TEST-001',
                 '0555000111','16','Alger','Rue Test',36.7538,3.0588, now())
         returning id`,
        [agentUid, NAME]
      )
    ).id;
    // Acheteur (livreur actif) servant de cible de revente.
    const buyerWallet = (
      await one(
        `insert into operator_wallets (owner_type, owner_id, is_partner, status)
         values ('driver',$1,false,'active') returning id`,
        [buyerUid]
      )
    ).id;

    await c.query("set local role authenticated");

    // ── LECTURE DU PROPRE PORTEFEUILLE (chemin getCurrentPartner) ───────────
    await asUser(agentUid);
    const ownRead = await one(
      "select id from operator_wallets where owner_type='partner' and owner_id=$1",
      [agentUid]
    );
    check(
      "Agent lit SON portefeuille (getCurrentPartner)",
      !!ownRead,
      ownRead ? "" : "RLS deny-all → dashboard cassé après connexion"
    );

    // ── RÉSOLUTION + PIN ────────────────────────────────────────────────────
    check(
      "my_operator_wallet() résout le partenaire",
      (await one("select my_operator_wallet() w")).w === agentWallet
    );
    check(
      "Définir PIN (4 chiffres)",
      (await one("select operator_set_pin('1234') r")).r.ok === true
    );

    // ── DÉPÔT DE PIÈCES ─────────────────────────────────────────────────────
    check(
      "Dépôt pièce dans SON dossier",
      typeof (
        await one(
          "select partner_add_document('registre_commerce',$1,null) r",
          [agentWallet + "/rc.pdf"]
        )
      ).r === "string"
    );
    await expectError(
      "Sécurité : pièce hors de son dossier refusée",
      "select partner_add_document('piece_identite',$1,null)",
      ["un-autre-wallet/x.pdf"],
      "Chemin non autorisé"
    );
    check(
      "Agent lit SES pièces",
      Number(
        (
          await one(
            "select count(*) n from partner_documents where wallet_id=$1",
            [agentWallet]
          )
        ).n
      ) >= 1
    );

    // ── INERTIE DU COMPTE PENDING ───────────────────────────────────────────
    const sellPending = (
      await one("select coligo_recharge_sell($1,1000,'1234',$2) r", [
        buyerWallet,
        "op-pending-1",
      ])
    ).r;
    check(
      "Vente refusée tant que pending (compte inerte)",
      sellPending.ok === false && sellPending.error === "not_active_partner",
      JSON.stringify(sellPending)
    );

    await c.query("reset role");
    const nearbyPending = await c.query(
      "select wallet_id from recharge_points_nearby(36.7538,3.0588,50,50)"
    );
    check(
      "Point pending INVISIBLE au public (recharge_points_nearby)",
      !nearbyPending.rows.some((r) => r.wallet_id === agentWallet)
    );

    // ── ANTI-AUTO-ACTIVATION (l'agent tente d'activer son wallet) ───────────
    await c.query("set local role authenticated");
    await asUser(agentUid);
    await c.query("savepoint sp_self");
    let selfRows = 0;
    let selfErr = null;
    try {
      const r = await c.query(
        "update operator_wallets set status='active', is_verified=true where id=$1",
        [agentWallet]
      );
      selfRows = r.rowCount;
      await c.query("release savepoint sp_self");
    } catch (e) {
      selfErr = e;
      await c.query("rollback to savepoint sp_self");
    }
    await c.query("reset role");
    const stStill = await one(
      "select status, is_verified from operator_wallets where id=$1",
      [agentWallet]
    );
    check(
      "Anti-fraude : agent ne peut PAS s'auto-activer",
      stStill.status === "pending" && stStill.is_verified === false,
      `rows=${selfRows} err=${selfErr?.code ?? "-"} status=${stStill.status}`
    );

    // ── ANTI-DOUBLON (un seul portefeuille par compte) ──────────────────────
    await expectError(
      "Anti-doublon : un seul portefeuille par compte",
      "insert into operator_wallets (owner_type,owner_id,is_partner,status) values ('partner',$1,true,'pending')",
      [agentUid],
      "duplicate"
    );

    // ── VALIDATION ADMIN (miroir de l'action serveur : UPDATE service_role) ─
    await one(
      "update operator_wallets set status='active', is_verified=true, verified_at=now(), rejected_reason=null where id=$1 returning id",
      [agentWallet]
    );
    await c.query(
      "insert into operator_wallet_entries (wallet_id,type,amount_da,note,client_operation_id) values ($1,'topup_manual',5000,'TEST credit','test-credit-1')",
      [agentWallet]
    );
    check(
      "Après validation : crédit agent = 5000",
      Number((await one("select operator_balance($1) b", [agentWallet])).b) ===
        5000
    );

    const nearbyActive = await c.query(
      "select wallet_id from recharge_points_nearby(36.7538,3.0588,50,50)"
    );
    check(
      "Point actif VISIBLE au public (recharge_points_nearby)",
      nearbyActive.rows.some((r) => r.wallet_id === agentWallet)
    );

    // ── REVENTE (compte actif) ──────────────────────────────────────────────
    await c.query("set local role authenticated");
    await asUser(agentUid);
    const sell1 = (
      await one("select coligo_recharge_sell($1,1000,'1234',$2) r", [
        buyerWallet,
        "op-sell-1",
      ])
    ).r;
    check(
      "Revente OK (compte actif)",
      sell1.ok === true,
      JSON.stringify(sell1)
    );
    check(
      "Solde vendeur après revente = 4000",
      Number(sell1.seller_balance) === 4000
    );
    check(
      "Solde acheteur après revente = 1000",
      Number(sell1.target_balance) === 1000
    );

    await c.query("reset role");
    const de = Number(
      (
        await one(
          "select coalesce(sum(amount_da),0) s from operator_wallet_entries where client_operation_id=$1",
          ["op-sell-1"]
        )
      ).s
    );
    check("Revente : DOUBLE-ENTRÉE = 0", de === 0);

    await c.query("set local role authenticated");
    await asUser(agentUid);
    const sellIdem = (
      await one("select coligo_recharge_sell($1,1000,'1234',$2) r", [
        buyerWallet,
        "op-sell-1",
      ])
    ).r;
    check(
      "Revente : idempotence (rejeu même op_id)",
      sellIdem.ok === true && sellIdem.already === true
    );
    check(
      "Idempotence : solde inchangé (4000)",
      Number(sellIdem.seller_balance) === 4000
    );

    const sellInsuf = (
      await one("select coligo_recharge_sell($1,999999,'1234',$2) r", [
        buyerWallet,
        "op-insuf-1",
      ])
    ).r;
    check(
      "Revente : solde insuffisant refusé",
      sellInsuf.ok === false && sellInsuf.error === "insufficient"
    );

    const sellPin = (
      await one("select coligo_recharge_sell($1,500,'0000',$2) r", [
        buyerWallet,
        "op-pin-1",
      ])
    ).r;
    check(
      "Revente : mauvais PIN refusé",
      sellPin.ok === false && String(sellPin.error).startsWith("pin")
    );

    const sellSelf = (
      await one("select coligo_recharge_sell($1,500,'1234',$2) r", [
        agentWallet,
        "op-self-1",
      ])
    ).r;
    check(
      "Revente : auto-bénéficiaire refusé",
      sellSelf.ok === false && sellSelf.error === "self_target"
    );

    // ── ISOLATION DES PIÈCES (un autre compte ne voit rien) ─────────────────
    await asUser(otherUid);
    check(
      "Isolation : un autre compte ne voit pas les pièces de l'agent",
      Number(
        (
          await one(
            "select count(*) n from partner_documents where wallet_id=$1",
            [agentWallet]
          )
        ).n
      ) === 0
    );

    await c.query("ROLLBACK");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("ERREUR TEST:", e.message);
    failures++;
  } finally {
    await c.end();
  }

  console.log(
    failures === 0
      ? "\n🎉 Tous les scénarios Agent Coligo Pay PASSENT (ROLLBACK — rien persisté)."
      : `\n💥 ${failures} scénario(s) en échec.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
