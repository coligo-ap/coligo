-- ============================================================
-- 0139 — Coligo Drive : schéma (refonte VTC selon maquette)
-- Config admin (AUCUNE valeur financière en dur ailleurs),
-- gammes, boost, femme au volant, abonnements, favoris,
-- signalements, documents chauffeur, TTL, proche, partage.
-- Réponses STOP ROU (2026-06-11) :
--   boost 100 % chauffeur sans commission · cashback 2 % pris
--   sur la commission · barème par gamme · femme au volant ON ·
--   gel 5 000 DA / 25 % sur 20 / note 4,0 sur 30 · CCP placeholder.
-- ============================================================

-- ---------- 1. Config plateforme (tout modifiable en admin) ----------
ALTER TABLE public.platform_settings
  -- Barème par gamme : base + DA/km + plancher (clamp silencieux)
  ADD COLUMN IF NOT EXISTS drive_pricing JSONB NOT NULL DEFAULT '{
    "classic": {"base": 150, "per_km": 45, "min": 250},
    "confort": {"base": 200, "per_km": 60, "min": 350},
    "moto":    {"base": 100, "per_km": 30, "min": 150}
  }'::jsonb,
  -- Majoration nuit 22h–6h, JAMAIS affichée, plafonnée ≤ 20 %
  ADD COLUMN IF NOT EXISTS drive_night_coef NUMERIC(4,3) NOT NULL DEFAULT 0.20,
  ADD COLUMN IF NOT EXISTS drive_night_start_h INTEGER NOT NULL DEFAULT 22,
  ADD COLUMN IF NOT EXISTS drive_night_end_h INTEGER NOT NULL DEFAULT 6,
  -- Plancher algorithmique : max(min gamme, coef × recommandé jour)
  ADD COLUMN IF NOT EXISTS drive_floor_rate NUMERIC(4,3) NOT NULL DEFAULT 0.70,
  -- Pas du sélecteur de prix client
  ADD COLUMN IF NOT EXISTS drive_price_step_da INTEGER NOT NULL DEFAULT 20,
  -- Boost : min 10 DA, pas de 5, défaut 10 % du trajet
  ADD COLUMN IF NOT EXISTS drive_boost_min_da INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS drive_boost_step_da INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS drive_boost_default_rate NUMERIC(4,3) NOT NULL DEFAULT 0.10,
  -- Cashback Drive : % du prix, FINANCÉ PAR LA COMMISSION (plafonné par elle)
  ADD COLUMN IF NOT EXISTS drive_cashback_rate NUMERIC(5,4) NOT NULL DEFAULT 0.02,
  -- Feature flag « Femme au volant »
  ADD COLUMN IF NOT EXISTS drive_female_filter_enabled BOOLEAN NOT NULL DEFAULT true,
  -- Seuils de gel automatique
  ADD COLUMN IF NOT EXISTS drive_freeze_debt_da INTEGER NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS drive_freeze_cancel_rate NUMERIC(4,3) NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS drive_freeze_cancel_window INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS drive_freeze_min_rating NUMERIC(3,2) NOT NULL DEFAULT 4.00,
  ADD COLUMN IF NOT EXISTS drive_freeze_rating_window INTEGER NOT NULL DEFAULT 30,
  -- Abonnements chauffeur (Gratuit = vtc_commission_rate existant)
  ADD COLUMN IF NOT EXISTS drive_plan_pro_fee_da INTEGER NOT NULL DEFAULT 1500,
  ADD COLUMN IF NOT EXISTS drive_plan_pro_rate NUMERIC(5,4) NOT NULL DEFAULT 0.035,
  ADD COLUMN IF NOT EXISTS drive_plan_premium_fee_da INTEGER NOT NULL DEFAULT 3900,
  ADD COLUMN IF NOT EXISTS drive_plan_premium_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drive_sub_grace_days INTEGER NOT NULL DEFAULT 5,
  -- CCP plateforme (PLACEHOLDER — à remplacer avant lancement réel)
  ADD COLUMN IF NOT EXISTS drive_ccp_number TEXT NOT NULL DEFAULT '000 000 000',
  ADD COLUMN IF NOT EXISTS drive_ccp_key TEXT NOT NULL DEFAULT '00',
  ADD COLUMN IF NOT EXISTS drive_ccp_name TEXT NOT NULL DEFAULT 'Coligo SPA',
  -- « Je rentre chez moi »
  ADD COLUMN IF NOT EXISTS drive_home_dir_max_per_day INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS drive_home_dir_tolerance_deg INTEGER NOT NULL DEFAULT 45,
  -- TTL demandes / propositions, back-to-back, attente client absent
  ADD COLUMN IF NOT EXISTS drive_request_ttl_min INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS drive_offer_ttl_min INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS drive_b2b_radius_km NUMERIC(4,1) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS drive_b2b_ttl_sec INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS drive_pickup_wait_min INTEGER NOT NULL DEFAULT 5,
  -- Détection d'itinéraire anormal (écart vs route prévue)
  ADD COLUMN IF NOT EXISTS drive_deviation_km NUMERIC(4,2) NOT NULL DEFAULT 1.20,
  ADD COLUMN IF NOT EXISTS drive_deviation_min INTEGER NOT NULL DEFAULT 2;

-- Garde-fous durs (analyse finance) : nuit ≤ 20 %, cashback ≤ commission de base
ALTER TABLE public.platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_drive_night_cap,
  ADD CONSTRAINT platform_settings_drive_night_cap
    CHECK (drive_night_coef >= 0 AND drive_night_coef <= 0.20);
ALTER TABLE public.platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_drive_cashback_cap,
  ADD CONSTRAINT platform_settings_drive_cashback_cap
    CHECK (drive_cashback_rate >= 0 AND drive_cashback_rate <= vtc_commission_rate);

-- ---------- 2. Chauffeurs : gamme, profil, domicile, conductrice, gel ----------
ALTER TABLE public.chauffeurs
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS gamme TEXT NOT NULL DEFAULT 'classic'
    CHECK (gamme IN ('classic', 'confort', 'moto')),
  ADD COLUMN IF NOT EXISTS is_female BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_female_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS home_addr_text TEXT,
  ADD COLUMN IF NOT EXISTS home_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS home_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS home_dir_date DATE,
  ADD COLUMN IF NOT EXISTS home_dir_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS selfie_url TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT,
  ADD COLUMN IF NOT EXISTS frozen_reason TEXT,
  ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sos_contacts JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Clientes : profil vérifié « femme » (condition d'accès au filtre rose)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_female_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sos_contacts JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ---------- 3. Documents chauffeur (permis r/v, carte grise, plaque, assurance, selfie) ----------
CREATE TABLE IF NOT EXISTS public.chauffeur_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chauffeur_id UUID NOT NULL REFERENCES public.chauffeurs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN
    ('permis_recto', 'permis_verso', 'carte_grise', 'plaque', 'assurance', 'selfie')),
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chauffeur_id, kind)
);
ALTER TABLE public.chauffeur_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chauffeur_documents_self ON public.chauffeur_documents;
CREATE POLICY chauffeur_documents_self ON public.chauffeur_documents
  FOR ALL USING (
    chauffeur_id IN (SELECT c.id FROM public.chauffeurs c WHERE c.user_id = auth.uid())
  ) WITH CHECK (
    chauffeur_id IN (SELECT c.id FROM public.chauffeurs c WHERE c.user_id = auth.uid())
  );

-- ---------- 4. Abonnements chauffeur ----------
CREATE TABLE IF NOT EXISTS public.chauffeur_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chauffeur_id UUID NOT NULL REFERENCES public.chauffeurs(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('pro', 'premium')),
  status TEXT NOT NULL DEFAULT 'pending_ccp'
    CHECK (status IN ('pending_ccp', 'active', 'expired', 'cancelled')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('ccp', 'card')),
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chauffeur_subs_active
  ON public.chauffeur_subscriptions (chauffeur_id, status, period_end DESC);
ALTER TABLE public.chauffeur_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chauffeur_subscriptions_self ON public.chauffeur_subscriptions;
CREATE POLICY chauffeur_subscriptions_self ON public.chauffeur_subscriptions
  FOR SELECT USING (
    chauffeur_id IN (SELECT c.id FROM public.chauffeurs c WHERE c.user_id = auth.uid())
  );

CREATE TABLE IF NOT EXISTS public.chauffeur_subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.chauffeur_subscriptions(id) ON DELETE CASCADE,
  chauffeur_id UUID NOT NULL REFERENCES public.chauffeurs(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('pro', 'premium')),
  amount_da INTEGER NOT NULL CHECK (amount_da > 0),
  method TEXT NOT NULL CHECK (method IN ('ccp', 'card')),
  receipt_url TEXT,
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chauffeur_sub_payments_pending
  ON public.chauffeur_subscription_payments (status, created_at DESC);
ALTER TABLE public.chauffeur_subscription_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chauffeur_subscription_payments_self ON public.chauffeur_subscription_payments;
CREATE POLICY chauffeur_subscription_payments_self ON public.chauffeur_subscription_payments
  FOR SELECT USING (
    chauffeur_id IN (SELECT c.id FROM public.chauffeurs c WHERE c.user_id = auth.uid())
  );

-- Recette abonnements côté plateforme
ALTER TYPE public.platform_ledger_type ADD VALUE IF NOT EXISTS 'drive_subscription_income';

-- ---------- 5. Courses : gamme, boost, conductrice, proche, partage, TTL ----------
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS gamme TEXT NOT NULL DEFAULT 'classic'
    CHECK (gamme IN ('classic', 'confort', 'moto')),
  ADD COLUMN IF NOT EXISTS boost_amount_da INTEGER NOT NULL DEFAULT 0 CHECK (boost_amount_da >= 0),
  ADD COLUMN IF NOT EXISTS female_only BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proxy_name TEXT,
  ADD COLUMN IF NOT EXISTS proxy_phone TEXT,
  ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS cashback_da INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_operation_id TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Idempotence création (un même client ne crée pas 2 courses avec le même op id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_rides_operation
  ON public.rides (customer_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;

ALTER TABLE public.ride_offers
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- ---------- 6. Favoris (chauffeurs favoris du client) ----------
CREATE TABLE IF NOT EXISTS public.customer_favorite_chauffeurs (
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  chauffeur_id UUID NOT NULL REFERENCES public.chauffeurs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, chauffeur_id)
);
ALTER TABLE public.customer_favorite_chauffeurs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_favorite_chauffeurs_self ON public.customer_favorite_chauffeurs;
CREATE POLICY customer_favorite_chauffeurs_self ON public.customer_favorite_chauffeurs
  FOR ALL USING (
    customer_id IN (SELECT cu.id FROM public.customers cu WHERE cu.user_id = auth.uid())
  ) WITH CHECK (
    customer_id IN (SELECT cu.id FROM public.customers cu WHERE cu.user_id = auth.uid())
  );

-- ---------- 7. Signalements (2 côtés, examinés sous 24 h) ----------
CREATE TABLE IF NOT EXISTS public.ride_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  reporter TEXT NOT NULL CHECK (reporter IN ('customer', 'chauffeur')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  decision TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE (ride_id, reporter)
);
CREATE INDEX IF NOT EXISTS idx_ride_reports_open ON public.ride_reports (status, created_at DESC);
ALTER TABLE public.ride_reports ENABLE ROW LEVEL SECURITY;
-- Lecture : chacun voit ses propres signalements (via la course)
DROP POLICY IF EXISTS ride_reports_select ON public.ride_reports;
CREATE POLICY ride_reports_select ON public.ride_reports
  FOR SELECT USING (
    ride_id IN (
      SELECT r.id FROM public.rides r
      WHERE r.customer_id IN (SELECT cu.id FROM public.customers cu WHERE cu.user_id = auth.uid())
         OR r.chauffeur_id IN (SELECT c.id FROM public.chauffeurs c WHERE c.user_id = auth.uid())
    )
  );

-- ---------- 8. Messages rapides in-app (client ↔ chauffeur, Realtime) ----------
CREATE TABLE IF NOT EXISTS public.ride_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('customer', 'chauffeur')),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ride_messages_ride ON public.ride_messages (ride_id, created_at);
ALTER TABLE public.ride_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ride_messages_participants ON public.ride_messages;
CREATE POLICY ride_messages_participants ON public.ride_messages
  FOR ALL USING (
    ride_id IN (
      SELECT r.id FROM public.rides r
      WHERE r.customer_id IN (SELECT cu.id FROM public.customers cu WHERE cu.user_id = auth.uid())
         OR r.chauffeur_id IN (SELECT c.id FROM public.chauffeurs c WHERE c.user_id = auth.uid())
    )
  ) WITH CHECK (
    ride_id IN (
      SELECT r.id FROM public.rides r
      WHERE r.customer_id IN (SELECT cu.id FROM public.customers cu WHERE cu.user_id = auth.uid())
         OR r.chauffeur_id IN (SELECT c.id FROM public.chauffeurs c WHERE c.user_id = auth.uid())
    )
  );
-- Realtime sur les messages de course
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
