// =============================================================================
// Test A→Z Coligo Pay (paiement marchand + transfert P2P) — ARGENT RÉEL.
// =============================================================================
// Exécute des scénarios de bout en bout DANS UNE TRANSACTION puis ROLLBACK :
// rien n'est persisté en prod. Vérifie l'exactitude comptable (double-entrée=0),
// la sécurité (PIN, lockout indirect via mauvais code), l'idempotence,
// l'anti double-dépense (solde), l'anti self-transfer, le token usage unique.
//
//   node scripts/test-coligo-pay.mjs   (ou: npm run test:coligo:pay)
//
// Sort en code 1 si un seul scénario échoue.
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

  // Deux clients + un commerçant réels (mapping auth.uid requis pour les RPC).
  const [sender, recipient] = (
    await c.query(
      "select c.id, c.user_id from customers c where c.user_id is not null limit 2"
    )
  ).rows;
  const merchant = await one(
    "select id, user_id, coalesce(commission_rate,0.05) rate from merchants where user_id is not null limit 1"
  );
  if (!sender || !recipient || !merchant) {
    console.error("Données insuffisantes (2 clients + 1 commerçant requis).");
    process.exit(2);
  }

  try {
    await c.query("BEGIN");

    // Solde déterministe : on crédite le sender de 5000 DA EN TANT QUE
    // PROPRIÉTAIRE (avant de passer en rôle authenticated, sinon la RLS
    // append-only bloque l'INSERT). Rollback à la fin → rien persisté.
    await c.query(
      "insert into customer_wallet_entries (customer_id, order_id, type, source, amount_da, note) values ($1,null,'topup_credit','topup',5000,'TEST')",
      [sender.id]
    );
    // Le client choisi peut avoir un solde réel préexistant : on mesure le
    // solde TOTAL (préexistant + 5000) pour que le scénario « insuffisant »
    // demande toujours plus que le disponible, quel que soit le client.
    const senderBal = Number(
      (
        await one(
          "select coalesce(sum(amount_da),0) b from customer_wallet_entries where customer_id=$1",
          [sender.id]
        )
      ).b
    );

    await c.query("set local role authenticated");

    // ── PIN ──────────────────────────────────────────────────────────────
    await asUser(sender.user_id);
    check(
      "PIN: refus d'un code non-4-chiffres",
      (await one("select coligo_pay_set_pin('12') r")).r.ok === false
    );
    check(
      "PIN: création 4 chiffres",
      (await one("select coligo_pay_set_pin('1234') r")).r.ok === true
    );

    // ── PAIEMENT MARCHAND ────────────────────────────────────────────────
    await asUser(merchant.user_id);
    const reqTok = "CPTEST" + Date.now().toString(36).toUpperCase();
    const created = (
      await one("select coligo_pay_create_request($1,$2,$3) r", [
        reqTok,
        1000,
        900,
      ])
    ).r;
    check("Paiement: création demande", created.ok === true);

    await asUser(sender.user_id);
    check(
      "Paiement: mauvais PIN refusé",
      (
        await one("select coligo_pay_execute($1,$2,$3) r", [
          reqTok,
          "0000",
          "op-pay-wrong-1",
        ])
      ).r.error === "pin_wrong"
    );
    const pay = (
      await one("select coligo_pay_execute($1,$2,$3) r", [
        reqTok,
        "1234",
        "op-pay-ok-1",
      ])
    ).r;
    check("Paiement: succès", pay.ok === true && pay.already === false);

    await c.query("reset role");
    const paySums = await one(
      `select
        (select coalesce(sum(amount_da),0) from customer_wallet_entries where coligo_pay_payment_id=$1) cust,
        (select coalesce(sum(amount_da),0) from wallet_entries where coligo_pay_payment_id=$1) merch,
        (select coalesce(sum(amount_da),0) from platform_ledger where coligo_pay_payment_id=$1) plat`,
      [pay.payment_id]
    );
    const comm = Math.round(1000 * Number(merchant.rate));
    check("Paiement: client débité −1000", Number(paySums.cust) === -1000);
    check(
      "Paiement: marchand net = +1000−commission",
      Number(paySums.merch) === 1000 - comm,
      `merch=${paySums.merch} comm=${comm}`
    );
    check("Paiement: plateforme = commission", Number(paySums.plat) === comm);
    check(
      "Paiement: DOUBLE-ENTRÉE = 0",
      Number(paySums.cust) + Number(paySums.merch) + Number(paySums.plat) === 0
    );

    await c.query("set local role authenticated");
    await asUser(sender.user_id);
    const payIdem = (
      await one("select coligo_pay_execute($1,$2,$3) r", [
        reqTok,
        "1234",
        "op-pay-ok-1",
      ])
    ).r;
    check("Paiement: idempotence (rejeu)", payIdem.already === true);
    check(
      "Paiement: token consommé (réutilisation refusée)",
      (
        await one("select coligo_pay_execute($1,$2,$3) r", [
          reqTok,
          "1234",
          "op-pay-ok-2",
        ])
      ).r.error === "used"
    );

    // ── TRANSFERT P2P ────────────────────────────────────────────────────
    await asUser(recipient.user_id);
    const handle = (await one("select coligo_pay_my_handle() r")).r.handle;
    check("Transfert: handle bénéficiaire généré", !!handle);

    await asUser(sender.user_id);
    check(
      "Transfert: résolution bénéficiaire",
      (await one("select coligo_pay_resolve_receiver($1) r", [handle])).r.ok ===
        true
    );
    check(
      "Transfert: mauvais PIN refusé",
      (
        await one("select coligo_pay_transfer($1,$2,$3,$4) r", [
          handle,
          300,
          "0000",
          "op-tr-wrong-1",
        ])
      ).r.error === "pin_wrong"
    );
    const tr = (
      await one("select coligo_pay_transfer($1,$2,$3,$4) r", [
        handle,
        300,
        "1234",
        "op-tr-ok-1",
      ])
    ).r;
    check("Transfert: succès", tr.ok === true && tr.already === false);

    await c.query("reset role");
    const trSums = await one(
      `select
        coalesce(sum(amount_da),0) total,
        (select amount_da from customer_wallet_entries where coligo_pay_transfer_id=$1 and customer_id=$2) sender_e,
        (select amount_da from customer_wallet_entries where coligo_pay_transfer_id=$1 and customer_id=$3) recv_e
       from customer_wallet_entries where coligo_pay_transfer_id=$1`,
      [tr.transfer_id, sender.id, recipient.id]
    );
    check("Transfert: expéditeur −300", Number(trSums.sender_e) === -300);
    check("Transfert: bénéficiaire +300", Number(trSums.recv_e) === 300);
    check("Transfert: DOUBLE-ENTRÉE = 0", Number(trSums.total) === 0);

    await c.query("set local role authenticated");
    await asUser(sender.user_id);
    check(
      "Transfert: idempotence (rejeu)",
      (
        await one("select coligo_pay_transfer($1,$2,$3,$4) r", [
          handle,
          300,
          "1234",
          "op-tr-ok-1",
        ])
      ).r.already === true
    );
    const myHandle = (await one("select coligo_pay_my_handle() r")).r.handle;
    check(
      "Transfert: anti self-transfer",
      (
        await one("select coligo_pay_transfer($1,$2,$3,$4) r", [
          myHandle,
          50,
          "1234",
          "op-tr-self-1",
        ])
      ).r.error === "self"
    );
    check(
      "Transfert: solde insuffisant refusé",
      (
        await one("select coligo_pay_transfer($1,$2,$3,$4) r", [
          handle,
          // Solde restant = total mesuré − 1000 (paiement) − 300 (transfert).
          senderBal - 1300 + 100,
          "1234",
          "op-tr-insuf-1",
        ])
      ).r.error === "insufficient"
    );
    check(
      "Transfert: bénéficiaire inconnu refusé",
      (
        await one("select coligo_pay_transfer($1,$2,$3,$4) r", [
          "ZZZZ0000",
          50,
          "1234",
          "op-tr-unknown-1",
        ])
      ).r.error === "not_found"
    );

    // ── ROBUSTESSE : changer email + téléphone ne doit RIEN perdre ─────────
    // (wallet/PIN/pay_handle/solde indexés par customers.id, jamais par
    // l'email/le téléphone). Le sender a déjà un pay_handle + PIN à ce stade.
    await c.query("reset role");
    const before = await one(
      `select pay_handle,
              public.customer_topup_balance(id) bal,
              (select count(*) from customer_wallet_security where customer_id=$1) pin,
              (select count(*) from coligo_pay_payments where customer_id=$1) pays
       from customers where id=$1`,
      [sender.id]
    );
    await c.query(
      "update customers set email = 'changed_' || id || '@test.dz', phone = '+213700000000' where id = $1",
      [sender.id]
    );
    const after = await one(
      `select pay_handle,
              public.customer_topup_balance(id) bal,
              (select count(*) from customer_wallet_security where customer_id=$1) pin,
              (select count(*) from coligo_pay_payments where customer_id=$1) pays
       from customers where id=$1`,
      [sender.id]
    );
    check(
      "Email/Tél changé: pay_handle conservé",
      !!after.pay_handle && before.pay_handle === after.pay_handle
    );
    check(
      "Email/Tél changé: solde conservé",
      String(before.bal) === String(after.bal)
    );
    check(
      "Email/Tél changé: PIN conservé",
      String(before.pin) === String(after.pin)
    );
    check(
      "Email/Tél changé: historique paiements conservé",
      String(before.pays) === String(after.pays)
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
      ? "\n🎉 Tous les scénarios Coligo Pay PASSENT (rien persisté — ROLLBACK)."
      : `\n💥 ${failures} scénario(s) en échec.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
