-- =============================================================================
-- 0302 — Cloisonnement RLS par DOMAINE (overlay RESTRICTIVE)
-- =============================================================================
-- On veut qu'un staff scopé (ex. Livraison) NE PUISSE PAS lire/écrire les
-- données d'un autre domaine (ex. finances commerçant) MÊME en tapant PostgREST
-- directement avec son JWT.
--
-- APPROCHE (sûre, minimale, non-régressive) : plutôt que réécrire les ~50
-- policies admin existantes (`USING (is_super_admin())`), on AJOUTE une policy
-- RESTRICTIVE par table sensible. Les policies RESTRICTIVE se combinent en AND
-- avec les permissives : la ligne n'est visible que si (permissives OR) ET
-- (toutes les restrictives). La condition :
--
--     NOT public.is_super_admin() OR public.admin_can('<domaine>') [OR ...]
--
--   • Non-admin (client / commerçant / livreur / anon) : is_super_admin() = false
--     ⇒ `NOT false` = TRUE ⇒ la restrictive est un NO-OP → ZÉRO régression.
--   • OWNER : admin_can() = true ⇒ TRUE → accès total conservé.
--   • STAFF hors domaine : is_super_admin() true, aucun admin_can() vrai ⇒ FALSE
--     ⇒ 0 ligne (lecture) / refus (écriture). ← le cloisonnement recherché.
--   • service_role (createAdminClient) : bypass total de la RLS → inchangé.
--
-- Chaque table peut autoriser PLUSIEURS domaines quand la donnée est
-- légitimement partagée entre back-offices (ex. le solde commerçant est vu par
-- Finances ET par Commerçants ET par Pilotage).
-- =============================================================================

DO $$
DECLARE
  rec  record;
  d    text;
  expr text;
  pol  text;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      -- table                          domaines autorisés (owner = tous)
      ('merchants',                 ARRAY['commercants','pilotage']),
      ('wallet_entries',            ARRAY['finances','commercants','pilotage']),
      ('platform_ledger',           ARRAY['finances','pilotage']),
      ('cashback_grants',           ARRAY['finances','pilotage']),
      ('platform_payment_accounts', ARRAY['finances']),
      ('operator_wallets',          ARRAY['finances']),
      ('operator_wallet_entries',   ARRAY['finances']),
      ('payout_requests',           ARRAY['finances','livraison','drive']),
      ('drivers',                   ARRAY['livraison','pilotage']),
      ('driver_statements',         ARRAY['livraison','finances']),
      ('driver_reviews',            ARRAY['livraison']),
      ('delivery_reports',          ARRAY['confiance','livraison']),
      ('chauffeurs',                ARRAY['drive','pilotage']),
      ('rides',                     ARRAY['drive','pilotage']),
      ('ride_reports',              ARRAY['confiance','drive']),
      ('reviews',                   ARRAY['confiance']),
      ('blocked_ips',               ARRAY['confiance']),
      ('customer_security_events',  ARRAY['confiance']),
      ('user_device_log',           ARRAY['confiance']),
      ('promo_banners',             ARRAY['marketing']),
      ('platform_promotions',       ARRAY['marketing','finances']),
      ('customer_vouchers',         ARRAY['marketing','finances'])
    ) AS t(tbl, doms)
  LOOP
    -- On ne touche que les tables réellement présentes (idempotent / robuste).
    IF to_regclass('public.' || rec.tbl) IS NULL THEN
      CONTINUE;
    END IF;

    expr := 'NOT public.is_super_admin()';
    FOREACH d IN ARRAY rec.doms LOOP
      expr := expr || format(' OR public.admin_can(%L)', d);
    END LOOP;

    pol := rec.tbl || '_admin_scope';
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, rec.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL '
      'USING (%s) WITH CHECK (%s)',
      pol, rec.tbl, expr, expr
    );
  END LOOP;
END $$;
