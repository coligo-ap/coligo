-- =============================================================================
-- 0397 — Gestion des CLIENTS par le super-admin (blocage + coupure ciblée)
-- =============================================================================
-- Nouveau domaine RBAC « clients » (9ᵉ), blocage d'un compte client, et coupure
-- d'une fonctionnalité POUR UN CLIENT DONNÉ (Coligo Pay, cashback, Drive,
-- paiement en ligne, Express, tournée…).
--
-- RÈGLE : l'enforcement est BYPASS-PROOF — il vit dans les MÊMES triggers que
-- les kill-switches globaux (mig 0182). Couper une fonctionnalité à un client
-- depuis l'admin ferme donc l'API pour lui, quelle que soit l'app utilisée ;
-- l'UI ne fait que refléter cet état.
--
-- Écritures admin : uniquement par RPC SECURITY DEFINER gardée `admin_can`, ce
-- qui laisse `protect_customer_risk_fields` refuser toute écriture directe des
-- champs de risque par le client lui-même.

-- -----------------------------------------------------------------------------
-- 1) Domaine RBAC « clients »
-- -----------------------------------------------------------------------------
alter table public.platform_admins
  drop constraint if exists platform_admins_domains_valid;
alter table public.platform_admins
  add constraint platform_admins_domains_valid
  check (domains <@ array[
    'pilotage', 'commercants', 'livraison', 'drive', 'finances',
    'confiance', 'plateforme', 'marketing', 'clients'
  ]::text[]);

-- -----------------------------------------------------------------------------
-- 2) Blocage d'un compte client
-- -----------------------------------------------------------------------------
alter table public.customers
  add column if not exists is_blocked boolean not null default false,
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_reason text,
  add column if not exists blocked_by text,
  add column if not exists admin_note text;

comment on column public.customers.is_blocked is
  'Compte suspendu par le super-admin : plus aucune commande ni course (triggers 0397).';

create index if not exists customers_blocked_idx
  on public.customers (is_blocked) where is_blocked;

-- Les champs de blocage rejoignent les champs de risque PROTÉGÉS : un client ne
-- peut pas se débloquer lui-même en écrivant sa propre ligne (RLS owner).
create or replace function public.protect_customer_risk_fields()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
BEGIN
  IF current_setting('app.allow_risk_update', true) IS DISTINCT FROM 'on' THEN
    NEW.cod_blocked     := OLD.cod_blocked;
    NEW.noshow_count    := OLD.noshow_count;
    NEW.noshow_pending  := OLD.noshow_pending;
    NEW.is_blocked      := OLD.is_blocked;
    NEW.blocked_at      := OLD.blocked_at;
    NEW.blocked_reason  := OLD.blocked_reason;
    NEW.blocked_by      := OLD.blocked_by;
    NEW.admin_note      := OLD.admin_note;
  END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3) Fonctionnalités coupées POUR UN CLIENT
-- -----------------------------------------------------------------------------
create table if not exists public.customer_feature_blocks (
  customer_id uuid not null references public.customers (id) on delete cascade,
  -- Mêmes clés que `feature_flags` (lib/data/feature-flags.ts).
  feature text not null check (feature in (
    'drive', 'online_payment', 'coligo_pay', 'cashback',
    'express', 'tour', 'barcode_marketplace', 'identity_verification'
  )),
  reason text,
  blocked_by text,
  created_at timestamptz not null default now(),
  primary key (customer_id, feature)
);

comment on table public.customer_feature_blocks is
  'Coupure d''une fonctionnalité pour UN client (mig 0397). Enforcement dans les triggers des kill-switches globaux.';

alter table public.customer_feature_blocks enable row level security;

-- Le client concerné peut LIRE ce qui lui est coupé (message honnête dans
-- l''app) ; personne n''écrit hors RPC admin (service_role / SECURITY DEFINER).
drop policy if exists customer_feature_blocks_select_own on public.customer_feature_blocks;
create policy customer_feature_blocks_select_own
  on public.customer_feature_blocks
  for select to authenticated
  using (
    exists (
      select 1 from public.customers c
       where c.id = customer_feature_blocks.customer_id
         and c.user_id = auth.uid()
    )
  );

drop policy if exists customer_feature_blocks_admin_all on public.customer_feature_blocks;
create policy customer_feature_blocks_admin_all
  on public.customer_feature_blocks
  for all to authenticated
  using (public.admin_can('clients'))
  with check (public.admin_can('clients'));

-- -----------------------------------------------------------------------------
-- 4) Helpers d'enforcement (STABLE, SECURITY DEFINER)
-- -----------------------------------------------------------------------------
create or replace function public.customer_is_blocked(p_customer_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (select c.is_blocked from public.customers c where c.id = p_customer_id),
    false
  );
$$;

create or replace function public.customer_feature_blocked(
  p_customer_id uuid,
  p_key text
)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.customer_feature_blocks b
     where b.customer_id = p_customer_id and b.feature = p_key
  );
$$;

/** Vue « ce qui est coupé pour moi » — sert au front client. */
create or replace function public.my_blocked_features()
returns table (feature text, reason text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select b.feature, b.reason
    from public.customer_feature_blocks b
    join public.customers c on c.id = b.customer_id
   where c.user_id = auth.uid();
$$;

grant execute on function public.customer_is_blocked(uuid) to authenticated, service_role;
grant execute on function public.customer_feature_blocked(uuid, text) to authenticated, service_role;
grant execute on function public.my_blocked_features() to authenticated;

-- -----------------------------------------------------------------------------
-- 5) ENFORCEMENT — compte bloqué / fonctionnalité coupée
-- -----------------------------------------------------------------------------
-- 5.1 COMMANDES : compte suspendu = aucune commande. Express / tournée coupés
--     pour ce client = mode de livraison refusé.
create or replace function public.enforce_customer_block_orders()
returns trigger language plpgsql
set search_path = public, pg_temp as $$
BEGIN
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.customer_is_blocked(NEW.customer_id) THEN
    RAISE EXCEPTION 'account_blocked' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.fulfillment_type = 'delivery'
     AND NEW.delivery_mode IS NOT NULL
     AND public.customer_feature_blocked(NEW.customer_id, NEW.delivery_mode) THEN
    RAISE EXCEPTION 'feature_disabled:%', NEW.delivery_mode
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $$;

drop trigger if exists trg_customer_block_orders on public.orders;
create trigger trg_customer_block_orders before insert on public.orders
  for each row execute function public.enforce_customer_block_orders();

-- 5.2 PAIEMENT EN LIGNE : kill-switch global (0182) + coupure par client.
create or replace function public.enforce_feature_online_payment()
returns trigger language plpgsql
set search_path = public, pg_temp as $$
BEGIN
  IF NEW.payment_method = 'online' THEN
    IF public.feature_blocked('online_payment')
       OR (NEW.customer_id IS NOT NULL
           AND public.customer_feature_blocked(NEW.customer_id, 'online_payment'))
    THEN
      RAISE EXCEPTION 'feature_disabled:online_payment'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- 5.3 DRIVE : kill-switch global + compte bloqué + coupure par client.
create or replace function public.enforce_feature_drive_rides()
returns trigger language plpgsql
set search_path = public, pg_temp as $$
BEGIN
  IF public.feature_blocked('drive') THEN
    RAISE EXCEPTION 'feature_disabled:drive' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.customer_id IS NOT NULL THEN
    IF public.customer_is_blocked(NEW.customer_id) THEN
      RAISE EXCEPTION 'account_blocked' USING ERRCODE = 'check_violation';
    END IF;
    IF public.customer_feature_blocked(NEW.customer_id, 'drive') THEN
      RAISE EXCEPTION 'feature_disabled:drive' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- 5.4 COLIGO PAY : kill-switch global + compte bloqué + coupure par client.
--     Une seule fonction pour les deux tables (colonnes de client différentes).
create or replace function public.enforce_feature_coligo_pay()
returns trigger language plpgsql
set search_path = public, pg_temp as $$
DECLARE v_customer UUID;
BEGIN
  IF public.feature_blocked('coligo_pay') THEN
    RAISE EXCEPTION 'feature_disabled:coligo_pay' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_TABLE_NAME = 'coligo_pay_payments' THEN
    v_customer := NEW.customer_id;
  ELSIF TG_TABLE_NAME = 'coligo_pay_transfers' THEN
    v_customer := NEW.sender_customer_id;
  END IF;

  IF v_customer IS NOT NULL THEN
    IF public.customer_is_blocked(v_customer) THEN
      RAISE EXCEPTION 'account_blocked' USING ERRCODE = 'check_violation';
    END IF;
    IF public.customer_feature_blocked(v_customer, 'coligo_pay') THEN
      RAISE EXCEPTION 'feature_disabled:coligo_pay' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END; $$;

-- 5.5 CASHBACK : jamais bloquant pour la commande — le gain est simplement nul.
--     La garde est posée dans le calcul CENTRAL (estimation ET versement).
create or replace function public.compute_order_cashback_da(o public.orders)
returns integer
language plpgsql stable security definer set search_path = public, pg_temp
as $$
DECLARE
  v_products   INTEGER;
  v_delivery   INTEGER;
  v_service    INTEGER;
  v_cash_rate  NUMERIC(5, 4);
  v_comm_rate  NUMERIC(5, 4);
  v_commission INTEGER;
  v_eligible   INTEGER;
  v_base       INTEGER;
  v_amount     INTEGER;
  v_is_tour    BOOLEAN;
  v_tour_rate  NUMERIC(5, 4);
  v_tour_comm  INTEGER := 0;
BEGIN
  -- Kill-switch super-admin : aucun cashback si la feature est coupée.
  IF public.feature_blocked('cashback') THEN
    RETURN 0;
  END IF;

  -- Cashback coupé POUR CE CLIENT (mig 0397) : même effet, ciblé.
  IF o.customer_id IS NOT NULL
     AND public.customer_feature_blocked(o.customer_id, 'cashback') THEN
    RETURN 0;
  END IF;

  v_products := GREATEST(0, COALESCE(o.net_total_da, o.subtotal_da - o.discount_da));
  v_delivery := COALESCE(o.delivery_fee_da, 0);
  v_service  := COALESCE(o.service_fee_da, 0);

  IF o.payment_method = 'cash' THEN
    v_cash_rate := public.resolve_rate(o.merchant_id, 'cashback_cash');
    v_comm_rate := public.resolve_rate(o.merchant_id, 'commission_cash');
  ELSE
    v_cash_rate := public.resolve_rate(o.merchant_id, 'cashback_online');
    v_comm_rate := public.resolve_rate(o.merchant_id, 'commission_online');
  END IF;

  -- ch.4.2 — Assiette = produits NETS (après promo) + frais de LIVRAISON.
  --          JAMAIS le frais de service (marge pure Coligo).
  -- ch.4.1 — Anti-boucle : on retire la part réglée DEPUIS le solde cashback.
  v_eligible := v_products + v_delivery;
  v_base     := GREATEST(0, v_eligible - GREATEST(0, COALESCE(o.cashback_used_da, 0)));
  v_amount   := round(v_base * v_cash_rate)::INTEGER;

  v_is_tour := (o.fulfillment_type = 'delivery' AND o.delivery_mode = 'tour');
  IF v_is_tour AND v_delivery > 0 THEN
    SELECT tour_delivery_commission_rate INTO v_tour_rate
      FROM public.platform_settings WHERE id = true;
    v_tour_comm := round(v_delivery * COALESCE(v_tour_rate, 0))::INTEGER;
  END IF;

  -- ch.4.4 — En COD la plateforme ABSORBE le cashback : plafonner à ce que
  -- Coligo encaisse réellement.
  IF o.payment_method = 'cash' THEN
    v_commission := round(v_products * v_comm_rate)::INTEGER;
    v_amount := LEAST(
      v_amount,
      (v_products / 2),
      GREATEST(v_commission + v_service +
               CASE WHEN v_is_tour THEN v_tour_comm ELSE v_delivery END, 0)
    );
  END IF;

  -- Échec de livraison → aucun cashback, SAUF commande PRÉPAYÉE EN LIGNE.
  IF o.delivery_failed_at IS NOT NULL
     AND NOT (o.payment_method <> 'cash' AND o.payment_status = 'paid') THEN
    v_amount := 0;
  END IF;

  RETURN GREATEST(0, v_amount);
END;
$$;

-- -----------------------------------------------------------------------------
-- 6) API ADMIN — annuaire, fiche, actions
-- -----------------------------------------------------------------------------
create or replace function public._customers_require_admin()
returns text
language plpgsql stable security definer set search_path = public, pg_temp
as $$
DECLARE v_email TEXT;
BEGIN
  IF NOT public.admin_can('clients') THEN
    RAISE EXCEPTION 'Accès refusé' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(auth.jwt() ->> 'email', 'admin');
END $$;

/**
 * Annuaire clients : recherche (nom / téléphone / e-mail / handle Pay),
 * filtre d'état, tri, pagination. `p_status` :
 *   null|'all' · 'blocked' · 'restricted' (au moins une coupure) ·
 *   'cod_blocked' · 'active'
 */
create or replace function public.admin_customers_directory(
  p_q text default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  phone text,
  email text,
  pay_handle text,
  created_at timestamptz,
  wilaya_code text,
  commune text,
  is_blocked boolean,
  blocked_at timestamptz,
  blocked_reason text,
  cod_blocked boolean,
  noshow_count integer,
  rating_avg numeric,
  rating_count integer,
  blocked_features text[],
  orders_count bigint,
  orders_completed bigint,
  spend_da bigint,
  rides_count bigint,
  cashback_balance_da integer,
  topup_balance_da integer,
  last_seen_at timestamptz,
  last_city text,
  last_country text,
  last_lat double precision,
  last_lng double precision,
  total_count bigint
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
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
           ) AS features
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
             WHEN 'blocked'     THEN b.is_blocked
             WHEN 'restricted'  THEN cardinality(b.features) > 0
             WHEN 'cod_blocked' THEN b.cod_blocked
             WHEN 'active'      THEN NOT b.is_blocked
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
  ORDER BY f.is_blocked DESC, f.created_at DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 200)
  OFFSET GREATEST(coalesce(p_offset, 0), 0);
END $$;

/** Dernières positions connues d'un client : appareils (IP), adresses
 *  enregistrées, livraisons et courses — du plus récent au plus ancien. */
create or replace function public.admin_customer_locations(
  p_customer_id uuid,
  p_limit integer default 40
)
returns table (
  kind text,
  label text,
  lat double precision,
  lng double precision,
  city text,
  seen_at timestamptz,
  detail text
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
DECLARE v_user UUID;
BEGIN
  PERFORM public._customers_require_admin();
  SELECT c.user_id INTO v_user FROM public.customers c WHERE c.id = p_customer_id;

  RETURN QUERY
  SELECT * FROM (
    -- Connexions (géo IP) — la « dernière localisation » la plus fraîche.
    SELECT 'device'::text, coalesce(l.city, l.country, 'Connexion'),
           l.lat, l.lng, l.city, l.last_seen_at,
           concat_ws(' · ', l.platform, l.ip)
      FROM public.user_device_log l
     WHERE l.user_id = v_user AND l.lat IS NOT NULL

    UNION ALL
    -- Adresses enregistrées.
    SELECT 'address'::text, coalesce(a.label, 'Adresse'),
           a.lat, a.lng, null::text, a.updated_at, a.address_text
      FROM public.customer_addresses a
     WHERE a.customer_id = p_customer_id AND a.lat IS NOT NULL

    UNION ALL
    -- Livraisons réellement effectuées.
    SELECT 'delivery'::text, coalesce(o.delivery_commune, 'Livraison'),
           o.delivery_lat, o.delivery_lng, o.delivery_commune,
           coalesce(o.delivery_delivered_at, o.created_at),
           o.delivery_address_text
      FROM public.orders o
     WHERE o.customer_id = p_customer_id AND o.delivery_lat IS NOT NULL

    UNION ALL
    -- Départs de course Drive.
    SELECT 'ride'::text, 'Course', rd.pickup_lat, rd.pickup_lng, null::text,
           rd.created_at, rd.pickup_text
      FROM public.rides rd
     WHERE rd.customer_id = p_customer_id AND rd.pickup_lat IS NOT NULL
  ) t
  ORDER BY t.seen_at DESC NULLS LAST
  LIMIT LEAST(GREATEST(coalesce(p_limit, 40), 1), 200);
END $$;

/** Suspend / réactive un compte client (journalisé). */
create or replace function public.admin_set_customer_block(
  p_customer_id uuid,
  p_blocked boolean,
  p_reason text default null
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
DECLARE v_admin TEXT;
BEGIN
  v_admin := public._customers_require_admin();
  PERFORM set_config('app.allow_risk_update', 'on', true);
  UPDATE public.customers
     SET is_blocked     = p_blocked,
         blocked_at     = CASE WHEN p_blocked THEN now() ELSE NULL END,
         blocked_reason = CASE WHEN p_blocked THEN nullif(btrim(coalesce(p_reason, '')), '') ELSE NULL END,
         blocked_by     = CASE WHEN p_blocked THEN v_admin ELSE NULL END
   WHERE id = p_customer_id;

  INSERT INTO public.admin_audit_log (admin_email, action, target_kind, target_id, note, new_value)
  VALUES (v_admin,
          CASE WHEN p_blocked THEN 'customer_block' ELSE 'customer_unblock' END,
          'customer', p_customer_id, p_reason,
          jsonb_build_object('is_blocked', p_blocked, 'reason', p_reason));
END $$;

/** Coupe / rétablit une fonctionnalité pour un client (journalisé). */
create or replace function public.admin_set_customer_feature(
  p_customer_id uuid,
  p_feature text,
  p_blocked boolean,
  p_reason text default null
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
DECLARE v_admin TEXT;
BEGIN
  v_admin := public._customers_require_admin();

  IF p_blocked THEN
    INSERT INTO public.customer_feature_blocks (customer_id, feature, reason, blocked_by)
    VALUES (p_customer_id, p_feature, nullif(btrim(coalesce(p_reason, '')), ''), v_admin)
    ON CONFLICT (customer_id, feature)
    DO UPDATE SET reason = excluded.reason, blocked_by = excluded.blocked_by;
  ELSE
    DELETE FROM public.customer_feature_blocks
     WHERE customer_id = p_customer_id AND feature = p_feature;
  END IF;

  INSERT INTO public.admin_audit_log (admin_email, action, target_kind, target_id, note, new_value)
  VALUES (v_admin,
          CASE WHEN p_blocked THEN 'customer_feature_block' ELSE 'customer_feature_unblock' END,
          'customer', p_customer_id, p_reason,
          jsonb_build_object('feature', p_feature, 'blocked', p_blocked));
END $$;

/** Note interne sur un client (visible des seuls admins). */
create or replace function public.admin_set_customer_note(
  p_customer_id uuid,
  p_note text
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
DECLARE v_admin TEXT;
BEGIN
  v_admin := public._customers_require_admin();
  PERFORM set_config('app.allow_risk_update', 'on', true);
  UPDATE public.customers
     SET admin_note = nullif(btrim(coalesce(p_note, '')), '')
   WHERE id = p_customer_id;
END $$;

-- Appelées depuis une session ADMIN (rôle `authenticated`) — la garde
-- `admin_can('clients')` est DANS la fonction (fail-closed).
grant execute on function public.admin_customers_directory(text, text, integer, integer)
  to authenticated, service_role;
grant execute on function public.admin_customer_locations(uuid, integer)
  to authenticated, service_role;
grant execute on function public.admin_set_customer_block(uuid, boolean, text)
  to authenticated, service_role;
grant execute on function public.admin_set_customer_feature(uuid, text, boolean, text)
  to authenticated, service_role;
grant execute on function public.admin_set_customer_note(uuid, text)
  to authenticated, service_role;
revoke execute on function public.admin_customers_directory(text, text, integer, integer) from anon;
revoke execute on function public.admin_customer_locations(uuid, integer) from anon;
revoke execute on function public.admin_set_customer_block(uuid, boolean, text) from anon;
revoke execute on function public.admin_set_customer_feature(uuid, text, boolean, text) from anon;
revoke execute on function public.admin_set_customer_note(uuid, text) from anon;
