-- =============================================================================
-- 0376 — Paiements internationaux en EUR via Stripe (diaspora)
-- =============================================================================
-- Second rail « online » à côté de Chargily : la commande garde
-- payment_method='online' + payment_status='pending' (AUCUN trigger financier
-- touché), seule la page de paiement diffère (Stripe Checkout, montant EUR).
-- Le webhook Stripe seul fait foi (pending → paid), comme Chargily.
--
-- Règles produit (proprio, 18/07/2026) :
--   - le TAUX DE CHANGE n'est JAMAIS exposé au client ; il vit ici, côté
--     serveur/admin uniquement ;
--   - taux mode 'auto' = taux du marché parallèle observé − marge (défaut
--     30 DA), borné par un plancher/plafond de sanité ; mode 'manual' =
--     valeur imposée par le super-admin, effet immédiat ;
--   - option visible uniquement dans certains PAYS (IP) choisis par l'admin ;
--   - plafonds : par commande, par client/jour, par client/mois, plateforme/
--     jour et /mois ; capacité atteinte ⇒ option coupée + message client +
--     alerte super-admin ;
--   - tout est auditable (sessions, événements webhook, snapshots de taux,
--     changements de config via admin_audit_log).
--
-- Sécurité : TOUTES les tables sont service_role only (RLS activée, zéro
-- policy) — lectures admin via pages server-component service_role
-- auto-gardées, écritures via server actions/webhook. Fonctions REVOKE
-- authenticated/anon (cf. mig 0276).
-- =============================================================================

-- ───────────────────────────────── 1. Réglages (singleton) ──────────────────
CREATE TABLE IF NOT EXISTS public.intl_payment_settings (
  id                       boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  enabled                  boolean NOT NULL DEFAULT false,
  -- Codes ISO-3166 alpha-2 (header x-vercel-ip-country). DZ inclus par défaut
  -- pour les tests du propriétaire depuis l'Algérie — à retirer au lancement.
  allowed_countries        text[]  NOT NULL DEFAULT '{FR,BE,DE,ES,IT,NL,LU,CH,GB,DZ}',
  -- Taux : 1 EUR = X DA. 'auto' = parallèle − marge, borné ; 'manual' = imposé.
  rate_mode                text    NOT NULL DEFAULT 'auto'
                           CHECK (rate_mode IN ('auto','manual')),
  manual_rate_da           numeric(8,2),
  auto_margin_da           numeric(8,2) NOT NULL DEFAULT 30,
  rate_floor_da            numeric(8,2) NOT NULL DEFAULT 150,
  rate_ceiling_da          numeric(8,2) NOT NULL DEFAULT 400,
  -- Plafonds en CENTIMES d'euro (entiers, pas de flottants sur l'argent).
  per_order_min_eur_cents  integer NOT NULL DEFAULT 500      CHECK (per_order_min_eur_cents  >= 0),
  per_order_max_eur_cents  integer NOT NULL DEFAULT 30000    CHECK (per_order_max_eur_cents  > 0),
  per_user_day_eur_cents   integer NOT NULL DEFAULT 30000    CHECK (per_user_day_eur_cents   > 0),
  per_user_month_eur_cents integer NOT NULL DEFAULT 80000    CHECK (per_user_month_eur_cents > 0),
  platform_day_eur_cents   integer NOT NULL DEFAULT 100000   CHECK (platform_day_eur_cents   > 0),
  platform_month_eur_cents integer NOT NULL DEFAULT 200000   CHECK (platform_month_eur_cents > 0),
  -- PayPal via Stripe (comptes Stripe UE uniquement) — off tant que non vérifié.
  paypal_enabled           boolean NOT NULL DEFAULT false,
  updated_by               text,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.intl_payment_settings (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.intl_payment_settings ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────── 2. Snapshots du taux parallèle ─────────────────
-- Chaque tentative de lecture du marché parallèle est tracée (réussie ou non) ;
-- le moteur lit le dernier snapshot ok < 6 h, sinon re-fetch, sinon dernier
-- connu (fail-soft), sinon option coupée (fail-closed — jamais un taux inventé).
CREATE TABLE IF NOT EXISTS public.intl_rate_snapshots (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source      text NOT NULL,                 -- 'devise-dz' | 'manual' | …
  raw_rate_da numeric(8,2),                  -- 1 EUR = X DA observé (si ok)
  ok          boolean NOT NULL,
  note        text,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intl_rate_snapshots_fetched
  ON public.intl_rate_snapshots (fetched_at DESC);
ALTER TABLE public.intl_rate_snapshots ENABLE ROW LEVEL SECURITY;

-- ───────────────────────────── 3. Sessions Stripe ───────────────────────────
-- Une ligne par session Stripe Checkout créée. Le taux appliqué y est FIGÉ
-- (audit : on sait toujours à quel taux un paiement est parti). Les plafonds
-- comptent les 'paid' + les 'created' récents (session ouverte ≤ 35 min).
CREATE TABLE IF NOT EXISTS public.intl_payment_sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid NOT NULL REFERENCES public.orders(id),
  customer_id           uuid NOT NULL REFERENCES public.customers(id),
  stripe_session_id     text UNIQUE,
  stripe_payment_intent text,
  eur_cents             integer NOT NULL CHECK (eur_cents > 0),
  total_da              integer NOT NULL CHECK (total_da > 0),
  rate_da               numeric(8,2) NOT NULL,
  rate_source           text NOT NULL,       -- 'manual' | 'auto:devise-dz' | …
  ip_country            text,
  status                text NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created','paid','failed','expired','refunded')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  paid_at               timestamptz
);
CREATE INDEX IF NOT EXISTS idx_intl_sessions_order    ON public.intl_payment_sessions (order_id);
CREATE INDEX IF NOT EXISTS idx_intl_sessions_customer ON public.intl_payment_sessions (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intl_sessions_caps     ON public.intl_payment_sessions (created_at DESC) WHERE status IN ('created','paid');
ALTER TABLE public.intl_payment_sessions ENABLE ROW LEVEL SECURITY;

-- ─────────────── 4. Événements webhook (idempotence + audit brut) ───────────
CREATE TABLE IF NOT EXISTS public.intl_payment_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stripe_event_id text UNIQUE,               -- rejeu Stripe ⇒ 23505 absorbé
  type            text NOT NULL,
  session_id      uuid REFERENCES public.intl_payment_sessions(id),
  payload         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.intl_payment_events ENABLE ROW LEVEL SECURITY;

-- ─────────────────── 5. Liste d'attente « capacité atteinte » ───────────────
-- Le client qui tombe sur « paiements € momentanément indisponibles » peut
-- demander à être prévenu ; l'admin (ou un job) notifie à la réouverture.
CREATE TABLE IF NOT EXISTS public.intl_capacity_waitlist (
  customer_id uuid PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);
ALTER TABLE public.intl_capacity_waitlist ENABLE ROW LEVEL SECURITY;

-- ───────────────────────── 6. Usage des plafonds (une requête) ──────────────
-- 'created' ne compte que ≤ 35 min (durée de vie d'une session Checkout : 30
-- min) : une session abandonnée libère sa réservation de plafond toute seule.
CREATE OR REPLACE FUNCTION public.intl_caps_usage(p_customer uuid)
RETURNS TABLE (
  user_day_cents bigint, user_month_cents bigint,
  platform_day_cents bigint, platform_month_cents bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH live AS (
    SELECT customer_id, eur_cents, created_at
      FROM public.intl_payment_sessions
     WHERE (status = 'paid'
            OR (status = 'created' AND created_at > now() - interval '35 minutes'))
       AND created_at > now() - interval '32 days'
  )
  SELECT
    COALESCE(SUM(eur_cents) FILTER (WHERE customer_id = p_customer
             AND created_at > now() - interval '24 hours'), 0),
    COALESCE(SUM(eur_cents) FILTER (WHERE customer_id = p_customer
             AND created_at > date_trunc('month', now())), 0),
    COALESCE(SUM(eur_cents) FILTER (WHERE created_at > now() - interval '24 hours'), 0),
    COALESCE(SUM(eur_cents) FILTER (WHERE created_at > date_trunc('month', now())), 0)
    FROM live;
$$;
REVOKE ALL ON FUNCTION public.intl_caps_usage(uuid)
  FROM PUBLIC, authenticated, anon;

-- ───────────────────── 7. Alertes super-admin (domaine finances) ────────────
-- CREATE OR REPLACE : conserve les 5 règles de 0296 + 3 règles intl :
--   - intl_capacity_block : des clients ont buté sur la capacité (24 h) ;
--   - intl_rate_fetch_fail : le fetch du taux parallèle échoue en série (24 h) ;
--   - intl_webhook_sig_fail : signatures webhook Stripe invalides (24 h) —
--     tentative d'usurpation possible, à regarder.
CREATE OR REPLACE FUNCTION public._admin_alert_rules_finances()
RETURNS TABLE (
  code text, domain text, severity text, prio int,
  count int, since timestamptz, label text, href text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'payouts_pending', 'finances',
         CASE WHEN MIN(pr.created_at) < now() - interval '3 days'
              THEN 'warning' ELSE 'info' END,
         CASE WHEN MIN(pr.created_at) < now() - interval '3 days' THEN 2 ELSE 1 END,
         COUNT(*)::int, MIN(pr.created_at),
         'Versements à traiter', '/admin/versements'
    FROM public.payout_requests pr
   WHERE pr.status IN ('pending','approved')
  HAVING COUNT(*) > 0

  UNION ALL
  SELECT 'topup_pending', 'finances',
         CASE WHEN MIN(tr.created_at) < now() - interval '24 hours'
              THEN 'warning' ELSE 'info' END,
         CASE WHEN MIN(tr.created_at) < now() - interval '24 hours' THEN 2 ELSE 1 END,
         COUNT(*)::int, MIN(tr.created_at),
         'Preuves de recharge à valider', '/admin/recharges'
    FROM public.wallet_topup_requests tr
   WHERE tr.status = 'pending'
  HAVING COUNT(*) > 0

  UNION ALL
  SELECT 'partner_docs_pending', 'finances',
         CASE WHEN MIN(pd.created_at) < now() - interval '24 hours'
              THEN 'warning' ELSE 'info' END,
         CASE WHEN MIN(pd.created_at) < now() - interval '24 hours' THEN 2 ELSE 1 END,
         COUNT(DISTINCT pd.wallet_id)::int, MIN(pd.created_at),
         'Agents à valider (pièces)', '/admin/agents'
    FROM public.partner_documents pd
   WHERE pd.status = 'pending'
  HAVING COUNT(*) > 0

  UNION ALL
  SELECT 'operator_wallets_negative', 'finances', 'warning', 2,
         COUNT(*)::int, NULL::timestamptz,
         'Portefeuilles opérateur en dépassement', '/admin/recharges'
    FROM public.operator_wallets w
   WHERE public.operator_balance(w.id) < -public.operator_neg_threshold(w.id)
  HAVING COUNT(*) > 0

  UNION ALL
  SELECT 'paid_after_cancel', 'finances', 'warning', 2,
         COUNT(*)::int, MIN(al.created_at),
         'Paiements reçus après annulation — à réconcilier', '/admin/coligo-pay'
    FROM public.admin_audit_log al
   WHERE al.action = 'paid_after_cancel'
     AND al.created_at > now() - interval '7 days'
  HAVING COUNT(*) > 0

  UNION ALL
  -- Paiements € : capacité plateforme atteinte (clients refoulés sur 24 h)
  SELECT 'intl_capacity_block', 'finances', 'warning', 2,
         COUNT(*)::int, MIN(al.created_at),
         'Paiements € : capacité atteinte — clients refoulés',
         '/admin/coligo-pay/international'
    FROM public.admin_audit_log al
   WHERE al.action = 'intl_capacity_block'
     AND al.created_at > now() - interval '24 hours'
  HAVING COUNT(*) > 0

  UNION ALL
  -- Paiements € : le taux parallèle ne se met plus à jour (≥ 3 échecs / 24 h)
  SELECT 'intl_rate_fetch_fail', 'finances', 'warning', 2,
         COUNT(*)::int, MIN(rs.fetched_at),
         'Paiements € : échec de mise à jour du taux',
         '/admin/coligo-pay/international'
    FROM public.intl_rate_snapshots rs
   WHERE rs.ok = false
     AND rs.fetched_at > now() - interval '24 hours'
  HAVING COUNT(*) >= 3

  UNION ALL
  -- Paiements € : signatures webhook invalides (usurpation possible)
  SELECT 'intl_webhook_sig_fail', 'finances', 'critical', 3,
         COUNT(*)::int, MIN(al.created_at),
         'Paiements € : signatures webhook Stripe INVALIDES',
         '/admin/coligo-pay/international'
    FROM public.admin_audit_log al
   WHERE al.action = 'intl_webhook_sig_fail'
     AND al.created_at > now() - interval '24 hours'
  HAVING COUNT(*) > 0;
$$;
REVOKE ALL ON FUNCTION public._admin_alert_rules_finances()
  FROM PUBLIC, authenticated, anon;
