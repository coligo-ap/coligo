// =============================================================================
// RÉINITIALISATION DB — repart de zéro en GARDANT les utilisateurs.
//
// GARDE   : auth.users + profils (commerçants/clients/livreurs/chauffeurs/admins)
//           + catalogue (catégories/produits/options) + config (platform_settings,
//           feature_flags, zones, comptes paiement) + gazetteer géo + KYC/docs
//           + statut de vérification + portefeuilles opérateur (vidés de leurs écritures).
// VIDE    : commandes, courses, TOUS les grands livres/soldes, paiements, créneaux/
//           tournées, presence, avis/favoris, promotions, adresses client, stats & logs.
// RESET   : compteurs en cache des profils (notes, noshow, orders_count, scores).
//
// Sécurité : backup JSON des tables vidées AVANT, puis transaction.
//   • sans argument            → DRY-RUN (ROLLBACK, n'écrit rien) + rapport.
//   • avec --commit            → exécute réellement (COMMIT).
// =============================================================================
import pg from "pg";
import { writeFileSync } from "node:fs";
import { getDbUrl } from "./_supabase.mjs";

const COMMIT = process.argv.includes("--commit");

// Tables à VIDER (TRUNCATE … RESTART IDENTITY CASCADE).
const WIPE = [
  // commandes & items
  "orders",
  "order_items",
  "order_item_options",
  "order_events",
  "order_messages",
  "order_promotions",
  // courses VTC
  "rides",
  "ride_events",
  "ride_ledger",
  "ride_messages",
  "ride_offers",
  "ride_reports",
  // grands livres / argent
  "wallet_entries",
  "customer_wallet_entries",
  "operator_wallet_entries",
  "platform_ledger",
  "delivery_ledger",
  "cashback_grants",
  // paiements / demandes
  "coligo_pay_payments",
  "coligo_pay_requests",
  "coligo_pay_transfers",
  "payout_requests",
  "wallet_topup_requests",
  "topup_reservations",
  "chauffeur_subscription_payments",
  // abonnements (état de compte)
  "priority_subscriptions",
  "chauffeur_subscriptions",
  // opérations livraison
  "delivery_slots",
  "delivery_tours",
  "tour_stops",
  "delivery_reports",
  "driver_refund_claims",
  "driver_statements",
  "driver_reviews",
  "driver_change_requests",
  "driver_availability",
  "express_declines",
  "merchant_driver_events",
  // presence temps réel
  "driver_presence",
  "chauffeur_presence",
  // avis / notations / favoris
  "reviews",
  "customer_ratings",
  "customer_favorites",
  "customer_favorite_chauffeurs",
  // promotions commerçant (gardé : promo_banners éditoriales admin)
  "promotions",
  "promotion_products",
  "promotion_redemptions",
  // annexes client
  "customer_addresses",
  // stats & logs
  "admin_audit_log",
  "api_usage_daily",
  "user_device_log",
  "device_tokens",
  "user_place_stats",
  "geo_quotes",
  "geo_picks",
  "geo_search_misses",
  "geo_google_cache",
  // évènements sécurité / throttle
  "customer_security_events",
  "customer_wallet_security",
  "operator_wallet_security",
  "email_change_throttle",
  // évènements zones
  "zone_block_events",
  "zone_waitlist",
  // apprentissage prix drive
  "drive_price_learning",
];

// Tables GARDÉES — vérifiées non vidées après coup (sentinelle anti-CASCADE).
const KEEP_GUARD = [
  "merchants",
  "customers",
  "drivers",
  "chauffeurs",
  "platform_admins",
  "categories",
  "products",
  "product_options",
  "product_option_groups",
  "merchant_delivery_zones",
  "merchant_tour_schedule",
  "merchant_referral_codes",
  "merchant_drivers",
  "operator_wallets",
  "driver_payout_methods",
  "driver_documents",
  "chauffeur_documents",
  "partner_documents",
  "platform_settings",
  "feature_flags",
  "platform_config_registry",
  "platform_payment_accounts",
  "service_zone_defaults",
  "geo_places",
  "drive_detour_zone",
  "drive_zone_anchor",
  "promo_banners",
];

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();

const count = async (t) =>
  (await c.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n;

try {
  console.log(
    `MODE : ${COMMIT ? "⚠️  COMMIT (réel)" : "DRY-RUN (rollback)"}\n`
  );

  // 0) état avant
  const before = {};
  for (const t of [...WIPE, ...KEEP_GUARD]) before[t] = await count(t);

  // 1) BACKUP JSON des tables vidées (volumes petits)
  const backup = {};
  let totalRows = 0;
  for (const t of WIPE) {
    const rows = (await c.query(`SELECT * FROM public.${t}`)).rows;
    backup[t] = rows;
    totalRows += rows.length;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `db-reset-backup-${stamp}.json`;
  writeFileSync(file, JSON.stringify(backup, null, 0));
  console.log(
    `📦 Backup écrit : ${file}  (${totalRows} lignes, ${WIPE.length} tables)\n`
  );

  // 2) transaction
  await c.query("BEGIN");

  await c.query(
    `TRUNCATE ${WIPE.map((t) => "public." + t).join(", ")} RESTART IDENTITY CASCADE`
  );

  // 3) reset des compteurs en cache (profils gardés)
  await c.query(`UPDATE public.customers SET
      noshow_count=0, noshow_pending=false, cod_blocked=false,
      rating_avg=0, rating_count=0`);
  await c.query(`UPDATE public.merchants SET
      orders_count=0, rating_avg=0, rating_count=0,
      score_quality=0, score_speed=0, scores_updated_at=NULL`);
  await c.query(`UPDATE public.drivers SET rating_avg=0, rating_count=0`);
  await c.query(`UPDATE public.chauffeurs SET
      home_dir_count=0, home_addr_change_count=0`);

  // 4) vérifs
  const after = {};
  for (const t of [...WIPE, ...KEEP_GUARD]) after[t] = await count(t);

  const wipedOk = WIPE.every((t) => after[t] === 0);
  const keptOk = KEEP_GUARD.every((t) => after[t] === before[t]);

  console.log("VIDÉ (doit être 0) :");
  for (const t of WIPE)
    if (before[t] > 0)
      console.log(
        `   ${t}: ${before[t]} → ${after[t]} ${after[t] === 0 ? "✅" : "❌"}`
      );
  console.log("\nGARDÉ (doit être inchangé) :");
  for (const t of KEEP_GUARD)
    console.log(
      `   ${t}: ${before[t]} → ${after[t]} ${after[t] === before[t] ? "✅" : "❌ MODIFIÉ !"}`
    );

  console.log(
    `\nBilan : tables vidées ${wipedOk ? "✅" : "❌"} | tables gardées intactes ${keptOk ? "✅" : "❌"}`
  );

  if (COMMIT && wipedOk && keptOk) {
    await c.query("COMMIT");
    console.log(
      "\n✅ COMMIT — base réinitialisée. Utilisateurs & catalogue conservés."
    );
  } else if (COMMIT) {
    await c.query("ROLLBACK");
    console.log(
      "\n❌ Anomalie détectée → ROLLBACK. Rien modifié. Vérifie le rapport."
    );
    process.exit(1);
  } else {
    await c.query("ROLLBACK");
    console.log(
      "\n(DRY-RUN → ROLLBACK, rien modifié. Relance avec --commit pour exécuter.)"
    );
  }
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  console.error("\n❌ ERREUR:", e.message);
  process.exit(1);
} finally {
  await c.end();
}
