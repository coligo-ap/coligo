// =============================================================================
// AUDIT D'INTÉGRITÉ LIVE — invariants financiers & d'état sur la VRAIE base.
// -----------------------------------------------------------------------------
// LECTURE SEULE (aucune écriture, aucun ROLLBACK nécessaire). À lancer à la
// demande (`npm run audit:integrity`) ou en CRON de surveillance : c'est
// l'équivalent d'un monitoring d'intégrité continu façon Uber — chaque requête
// remonte les LIGNES EN VIOLATION d'un invariant qui DOIT toujours être vide.
// Exit code 1 s'il en trouve une → utilisable en garde CI / alerte ops.
//
// Chaque invariant a été vérifié « à 0 violation » sur la prod au moment de
// l'écriture (baseline saine). Une violation future = régression réelle
// (fuite d'argent, gating cassé, ledger déséquilibré).
// =============================================================================
import { getDbUrl } from "./_supabase.mjs";
import pg from "pg";

const c = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});
await c.connect();

let violations = 0;
let checks = 0;

/**
 * Un invariant = une requête qui NE DOIT renvoyer AUCUNE ligne. Toute ligne
 * renvoyée est une violation (imprimée, tronquée à 5).
 */
async function invariant(label, sql, severity = "CRITIQUE") {
  checks++;
  try {
    const { rows } = await c.query(sql);
    if (rows.length === 0) {
      console.log(`  ✅ ${label}`);
    } else {
      violations++;
      console.log(
        `  ❌ [${severity}] ${label} — ${rows.length} violation(s) :`
      );
      rows
        .slice(0, 5)
        .forEach((r) => console.log("       ", JSON.stringify(r)));
      if (rows.length > 5) console.log(`        … +${rows.length - 5}`);
    }
  } catch (e) {
    violations++;
    console.log(`  ❌ [ERREUR] ${label} — ${e.message}`);
  }
}

try {
  console.log("\n── GATING PAIEMENT EN LIGNE (mig 0068) ──\n");
  await invariant(
    "Online payé/remboursé → possède un numéro de commande",
    `SELECT id, payment_status FROM public.orders
      WHERE payment_method='online' AND payment_status IN ('paid','refunded')
        AND (order_number IS NULL OR order_number='')`
  );
  await invariant(
    "Online NON payé → AUCUN numéro (jamais visible/effectif commerçant)",
    `SELECT id, payment_status, order_number FROM public.orders
      WHERE payment_method='online' AND payment_status NOT IN ('paid','refunded')
        AND order_number IS NOT NULL AND order_number<>''`
  );
  await invariant(
    "Aucune commande online COMPLÉTÉE mais non payée",
    `SELECT id, status, payment_status FROM public.orders
      WHERE payment_method='online' AND status='completed'
        AND payment_status NOT IN ('paid','refunded')`
  );

  console.log("\n── COLIGO PAY (portefeuille client) ──\n");
  await invariant(
    "Aucun solde Coligo Pay (topup) négatif",
    `SELECT cu.id, public.customer_topup_balance(cu.id) AS solde
       FROM public.customers cu WHERE public.customer_topup_balance(cu.id) < 0`
  );
  await invariant(
    "Aucun solde cashback négatif",
    `SELECT cu.id, public.customer_cashback_balance(cu.id) AS solde
       FROM public.customers cu WHERE public.customer_cashback_balance(cu.id) < 0`
  );
  await invariant(
    "Solde topup = SUM du grand livre (pas de dérive RPC/ledger)",
    `SELECT cu.id FROM public.customers cu
      GROUP BY cu.id
     HAVING COALESCE((SELECT SUM(amount_da) FROM public.customer_wallet_entries e
                       WHERE e.customer_id=cu.id AND e.source='topup'),0)
            <> public.customer_topup_balance(cu.id)`
  );

  console.log("\n── DOUBLE-ENTRÉE (SUM = 0) ──\n");
  await invariant(
    "P2P Coligo Pay : chaque transfert s'équilibre (débit + crédit = 0)",
    `SELECT coligo_pay_transfer_id, SUM(amount_da) AS ecart
       FROM public.customer_wallet_entries
      WHERE coligo_pay_transfer_id IS NOT NULL
      GROUP BY 1 HAVING SUM(amount_da) <> 0`
  );
  await invariant(
    "Paiement marchand Coligo Pay : débit client = −montant du paiement",
    `SELECT p.id, p.amount_da,
            COALESCE(SUM(e.amount_da),0) AS debit_client
       FROM public.coligo_pay_payments p
       LEFT JOIN public.customer_wallet_entries e ON e.coligo_pay_payment_id=p.id
      GROUP BY p.id, p.amount_da
     HAVING COALESCE(SUM(e.amount_da),0) <> -p.amount_da`
  );
  await invariant(
    "Transfert opérateur (inter-portefeuilles) : s'équilibre (SUM = 0)",
    `SELECT client_operation_id, SUM(amount_da) AS ecart
       FROM public.operator_wallet_entries
      WHERE counterparty_wallet_id IS NOT NULL
      GROUP BY 1 HAVING SUM(amount_da) <> 0`
  );

  console.log("\n── COHÉRENCE D'ÉTAT ──\n");
  await invariant(
    "Aucune commande livrée sans livreur attribué (delivery)",
    `SELECT id FROM public.orders
      WHERE fulfillment_type='delivery' AND delivery_delivered_at IS NOT NULL
        AND delivery_driver_id IS NULL`,
    "AVERTISSEMENT"
  );
} finally {
  await c.end();
}

console.log(
  `\n${violations === 0 ? "🎉 INTÉGRITÉ OK" : "🚨 VIOLATIONS DÉTECTÉES"} — ` +
    `${checks - violations}/${checks} invariants sains, ${violations} en échec.\n`
);
process.exit(violations === 0 ? 0 : 1);
