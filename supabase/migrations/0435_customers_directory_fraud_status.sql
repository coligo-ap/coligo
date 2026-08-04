-- =============================================================================
-- 0435 — ANNUAIRE CLIENTS × ANTI-FRAUDE : statut « suspendu » unifié.
--
-- Cas vécu (qawaexpress@gmail.com) : le module Anti-fraude (mig 0374) suspend
-- un client via fraud_actions (action 'suspend') — le client voit bien
-- « Compte suspendu » dans l'app (customer_fraud_gate) — mais l'annuaire
-- admin Clients ne lisait QUE customers.is_blocked → il affichait « Actif ».
-- Deux vérités parallèles pour le même compte.
--
-- Fix : admin_customers_directory expose fraud_suspended (sanction 'suspend'
-- active, ni révoquée ni expirée, via _fraud_has) ; les filtres « Suspendus »
-- / « Actifs » et le tri (suspendus d'abord) en tiennent compte.
--
-- RETURNS TABLE change → DROP puis CREATE (CREATE OR REPLACE ne peut pas
-- modifier les colonnes de sortie). Définition reprise du LIVE
-- (pg_get_functiondef, 05/08/2026), seule la partie fraud est ajoutée.
-- =============================================================================

DROP FUNCTION IF EXISTS public.admin_customers_directory(text, text, integer, integer);

CREATE FUNCTION public.admin_customers_directory(
  p_q text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
 RETURNS TABLE(
   id uuid, user_id uuid, full_name text, phone text, email text,
   pay_handle text, created_at timestamp with time zone,
   wilaya_code text, commune text,
   is_blocked boolean, blocked_at timestamp with time zone, blocked_reason text,
   cod_blocked boolean, noshow_count integer,
   rating_avg numeric, rating_count integer,
   blocked_features text[],
   orders_count bigint, orders_completed bigint, spend_da bigint,
   rides_count bigint,
   cashback_balance_da integer, topup_balance_da integer,
   last_seen_at timestamp with time zone, last_city text, last_country text,
   last_lat double precision, last_lng double precision,
   fraud_suspended boolean,
   total_count bigint
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_q TEXT := nullif(btrim(coalesce(p_q, '')), '');
  v_status TEXT := coalesce(nullif(p_status, ''), 'all');
BEGIN
  PERFORM public._customers_require_admin();

  RETURN QUERY
  WITH base AS (
    SELECT c.*,
           coalesce(
             (SELECT array_agg(b.feature ORDER BY b.feature)
                FROM public.customer_feature_blocks b
               WHERE b.customer_id = c.id),
             '{}'::text[]
           ) AS features,
           -- Sanction anti-fraude « suspend » ACTIVE (mig 0374) : c'est elle
           -- que voit le client via customer_fraud_gate — l'annuaire doit
           -- montrer la même vérité.
           public._fraud_has(c.id, 'suspend') AS fraud_suspended
      FROM public.customers c
     WHERE (
             v_q IS NULL
             OR c.full_name ILIKE '%' || v_q || '%'
             OR c.phone ILIKE '%' || v_q || '%'
             OR c.email ILIKE '%' || v_q || '%'
             OR c.pay_handle ILIKE '%' || v_q || '%'
           )
  ), filtered AS (
    SELECT * FROM base b
     WHERE CASE v_status
             WHEN 'blocked'     THEN (b.is_blocked OR b.fraud_suspended)
             WHEN 'restricted'  THEN cardinality(b.features) > 0
             WHEN 'cod_blocked' THEN b.cod_blocked
             WHEN 'active'      THEN NOT (b.is_blocked OR b.fraud_suspended)
             ELSE TRUE
           END
  ), counted AS (
    SELECT count(*) AS n FROM filtered
  )
  SELECT
    f.id, f.user_id, f.full_name, f.phone, f.email, f.pay_handle, f.created_at,
    f.default_wilaya_code, f.default_commune,
    f.is_blocked, f.blocked_at, f.blocked_reason,
    f.cod_blocked, f.noshow_count, f.rating_avg, f.rating_count,
    f.features,
    coalesce(o.n, 0), coalesce(o.done, 0), coalesce(o.spend, 0),
    coalesce(r.n, 0),
    public.customer_cashback_balance(f.id),
    public.customer_topup_balance(f.id),
    d.last_seen_at, d.city, d.country, d.lat, d.lng,
    f.fraud_suspended,
    (SELECT n FROM counted)
  FROM filtered f
  LEFT JOIN LATERAL (
    SELECT count(*) AS n,
           count(*) FILTER (WHERE ord.status = 'completed') AS done,
           coalesce(sum(ord.total_da) FILTER (WHERE ord.status = 'completed'), 0) AS spend
      FROM public.orders ord
     WHERE ord.customer_id = f.id
  ) o ON TRUE
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM public.rides rd WHERE rd.customer_id = f.id
  ) r ON TRUE
  LEFT JOIN LATERAL (
    SELECT l.last_seen_at, l.city, l.country, l.lat, l.lng
      FROM public.user_device_log l
     WHERE l.user_id = f.user_id
     ORDER BY l.last_seen_at DESC
     LIMIT 1
  ) d ON TRUE
  ORDER BY (f.is_blocked OR f.fraud_suspended) DESC, f.created_at DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 200)
  OFFSET GREATEST(coalesce(p_offset, 0), 0);
END $function$;

-- GRANT par rôle appelant (cf. règle EXECUTE par rôle) : l'annuaire est appelé
-- en session admin (authenticated) et par le serveur (service_role). La garde
-- réelle reste _customers_require_admin() DANS la fonction.
REVOKE ALL ON FUNCTION public.admin_customers_directory(text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_customers_directory(text, text, integer, integer) TO authenticated, service_role;
