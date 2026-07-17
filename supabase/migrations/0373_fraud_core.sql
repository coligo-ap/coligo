-- ============================================================================
-- 0373 — ANTI-FRAUDE : SOCLE (tables + catalogue de règles + réglages)
--
-- Moteur de Trust/Fraud/Risk Score pour les 4 populations (client, livreur,
-- chauffeur, commerçant). Voir docs/ANTI-FRAUDE.md pour l'architecture.
--
-- Sécurité : TOUTES les tables sont RLS ON **sans policy** → service_role
-- uniquement. L'admin passe par des RPC SECURITY DEFINER gardées
-- admin_can('confiance') (mig 0374) ; le client par 2 RPC étroites (gate +
-- acquittement de la popup), scellées auth.uid().
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) fraud_events — flux d'événements comportementaux NON déjà historisés
--    (l'existant — orders/order_events/rides/ride_offers/messages/devices —
--    reste la source primaire des détecteurs ; on ne duplique pas).
--    event_type (catalogue, TEXT libre pour évoluer sans migration) :
--      offer_seen | offer_ignored | offer_declined | offer_accepted
--      cancel (meta: phase, by)   | contact_revealed | call_initiated
--      forced_offline | went_online | went_offline
--      ack_required | ack_shown | ack_given
--      action_applied | action_revoked
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fraud_events (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_kind        TEXT NOT NULL CHECK (actor_kind IN ('customer','driver','chauffeur','merchant')),
  actor_id          UUID NOT NULL,
  user_id           UUID,
  event_type        TEXT NOT NULL CHECK (char_length(event_type) BETWEEN 2 AND 40),
  order_id          UUID,
  ride_id           UUID,
  counterparty_kind TEXT CHECK (counterparty_kind IN ('customer','driver','chauffeur','merchant')),
  counterparty_id   UUID,
  lat               DOUBLE PRECISION,
  lng               DOUBLE PRECISION,
  ip                TEXT,
  device            TEXT,
  meta              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fraud_events_actor
  ON public.fraud_events (actor_kind, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_events_type
  ON public.fraud_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_events_order
  ON public.fraud_events (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fraud_events_ride
  ON public.fraud_events (ride_id) WHERE ride_id IS NOT NULL;
ALTER TABLE public.fraud_events ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) fraud_scores — état courant par acteur (+ historique append-only)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fraud_scores (
  actor_kind       TEXT NOT NULL CHECK (actor_kind IN ('customer','driver','chauffeur','merchant')),
  actor_id         UUID NOT NULL,
  user_id          UUID,
  display_name     TEXT,                       -- dénormalisé pour les listes admin
  trust_score      INTEGER NOT NULL DEFAULT 60 CHECK (trust_score BETWEEN 0 AND 100),
  fraud_score      INTEGER NOT NULL DEFAULT 0  CHECK (fraud_score BETWEEN 0 AND 100),
  risk_score       INTEGER NOT NULL DEFAULT 0  CHECK (risk_score BETWEEN 0 AND 100),
  risk_level       TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high','critical')),
  components       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{rule,label,value,threshold,points,weight_eff}]
  features         JSONB NOT NULL DEFAULT '{}'::jsonb,  -- métriques brutes mesurées
  suspicious_count INTEGER NOT NULL DEFAULT 0,          -- situations suspectes (popup client ≥ seuil)
  evaluated_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_kind, actor_id)
);
CREATE INDEX IF NOT EXISTS idx_fraud_scores_risk
  ON public.fraud_scores (risk_score DESC, actor_kind);
CREATE INDEX IF NOT EXISTS idx_fraud_scores_user
  ON public.fraud_scores (user_id) WHERE user_id IS NOT NULL;
ALTER TABLE public.fraud_scores ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.fraud_score_history (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_kind  TEXT NOT NULL,
  actor_id    UUID NOT NULL,
  trust_score INTEGER NOT NULL,
  fraud_score INTEGER NOT NULL,
  risk_score  INTEGER NOT NULL,
  reason      TEXT,
  components  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fraud_score_history_actor
  ON public.fraud_score_history (actor_kind, actor_id, created_at DESC);
ALTER TABLE public.fraud_score_history ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) fraud_rules — catalogue configurable + compteurs d'APPRENTISSAGE
--    (confirmed_hits / dismissed_hits alimentés par l'examen admin des
--    alertes → poids effectif bayésien, voir fraud_rule_weight() en 0374).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fraud_rules (
  code           TEXT PRIMARY KEY,
  actor_kind     TEXT NOT NULL CHECK (actor_kind IN ('customer','driver','chauffeur','merchant','all')),
  category       TEXT NOT NULL,               -- annulation | refus | contact | multi_compte | plainte | anomalie | collusion | presence
  label          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  base_weight    NUMERIC(6,2) NOT NULL CHECK (base_weight >= 0),  -- points max au fraud_score
  params         JSONB NOT NULL DEFAULT '{}'::jsonb,              -- seuils (window_days, min_count, ratio, near_m, minutes…)
  severity       TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  enabled        BOOLEAN NOT NULL DEFAULT true,
  hits           INTEGER NOT NULL DEFAULT 0,  -- déclenchements cumulés
  confirmed_hits INTEGER NOT NULL DEFAULT 0,  -- alertes confirmées (fraude avérée)
  dismissed_hits INTEGER NOT NULL DEFAULT 0,  -- alertes rejetées (faux positif)
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fraud_rules ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) fraud_alerts — sorties du moteur, dédupliquées par (acteur, règle) tant
--    qu'ouvertes ; l'examen admin (confirmed/dismissed) = label d'apprentissage.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fraud_alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_kind        TEXT NOT NULL CHECK (actor_kind IN ('customer','driver','chauffeur','merchant')),
  actor_id          UUID NOT NULL,
  user_id           UUID,
  display_name      TEXT,
  rule_code         TEXT NOT NULL REFERENCES public.fraud_rules(code) ON DELETE CASCADE,
  severity          TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  title             TEXT NOT NULL,
  evidence          JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','confirmed','dismissed')),
  order_id          UUID,
  ride_id           UUID,
  occurrences       INTEGER NOT NULL DEFAULT 1,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by_email TEXT,
  reviewed_at       TIMESTAMPTZ,
  review_note       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fraud_alerts_open
  ON public.fraud_alerts (actor_kind, actor_id, rule_code)
  WHERE status IN ('open','investigating');
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_status
  ON public.fraud_alerts (status, severity, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_actor
  ON public.fraud_alerts (actor_kind, actor_id, created_at DESC);
ALTER TABLE public.fraud_alerts ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) fraud_actions — mesures appliquées (auto/admin), réversibles, notifiées.
--    active = revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fraud_actions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_kind        TEXT NOT NULL CHECK (actor_kind IN ('customer','driver','chauffeur','merchant')),
  actor_id          UUID NOT NULL,
  user_id           UUID,
  action            TEXT NOT NULL CHECK (action IN ('warn','require_ack','limit','force_offline','require_idv','suspend','restore','note')),
  source            TEXT NOT NULL CHECK (source IN ('auto','admin')),
  admin_email       TEXT,
  alert_id          UUID REFERENCES public.fraud_alerts(id) ON DELETE SET NULL,
  reason            TEXT NOT NULL,
  meta              JSONB NOT NULL DEFAULT '{}'::jsonb,
  notified_at       TIMESTAMPTZ,               -- NULL = notification partenaire/client à envoyer (lib/fraud/tick)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  revoked_by_email  TEXT,
  revoke_note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_fraud_actions_actor
  ON public.fraud_actions (actor_kind, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_actions_active
  ON public.fraud_actions (actor_kind, actor_id, action)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fraud_actions_to_notify
  ON public.fraud_actions (created_at) WHERE notified_at IS NULL;
ALTER TABLE public.fraud_actions ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) customer_fraud_acks — acceptations de la popup obligatoire (preuve).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_fraud_acks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  user_id     UUID,
  kind        TEXT NOT NULL DEFAULT 'cancel_scam_warning',
  action_id   UUID REFERENCES public.fraud_actions(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip          TEXT,
  device      TEXT,
  context     JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_customer_fraud_acks_customer
  ON public.customer_fraud_acks (customer_id, accepted_at DESC);
ALTER TABLE public.customer_fraud_acks ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) fraud_partner_presence — présence livreur (le chauffeur a déjà
--    chauffeur_presence). Alimentée par le pull Express + toggles ; le sweep
--    ferme les présences muettes et compte les offres ignorées d'affilée.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fraud_partner_presence (
  actor_kind        TEXT NOT NULL CHECK (actor_kind IN ('driver','chauffeur')),
  actor_id          UUID NOT NULL,
  user_id           UUID,
  is_online         BOOLEAN NOT NULL DEFAULT true,
  online_since      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_moved_at     TIMESTAMPTZ,
  lat               DOUBLE PRECISION,
  lng               DOUBLE PRECISION,
  ignore_streak     INTEGER NOT NULL DEFAULT 0,
  last_offer_id     UUID,                      -- dernière offre montrée (détection des non-réponses)
  last_offer_at     TIMESTAMPTZ,
  forced_offline_at TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_kind, actor_id)
);
CREATE INDEX IF NOT EXISTS idx_fraud_presence_online
  ON public.fraud_partner_presence (is_online, last_seen_at) WHERE is_online;
ALTER TABLE public.fraud_partner_presence ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) fraud_population_stats — statistiques de pairs pour la détection
--    d'anomalies (z-scores), rafraîchies par le cron quotidien.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fraud_population_stats (
  actor_kind  TEXT NOT NULL,
  metric      TEXT NOT NULL,
  mean        DOUBLE PRECISION NOT NULL DEFAULT 0,
  stddev      DOUBLE PRECISION NOT NULL DEFAULT 0,
  p50         DOUBLE PRECISION NOT NULL DEFAULT 0,
  p95         DOUBLE PRECISION NOT NULL DEFAULT 0,
  n           INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_kind, metric)
);
ALTER TABLE public.fraud_population_stats ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) fraud_settings — réglages du moteur (clé → valeur jsonb), modifiables
--    depuis le Centre Anti-Fraude.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fraud_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fraud_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.fraud_settings (key, value, label) VALUES
  ('customer_ack_threshold',      '3',     'Situations suspectes avant popup client obligatoire'),
  ('partner_ignore_streak',       '3',     'Offres ignorées d''affilée avant déconnexion forcée'),
  ('chauffeur_stale_offline_min', '8',     'Minutes de présence muette avant hors-ligne forcé (chauffeur)'),
  ('driver_stale_offline_min',    '10',    'Minutes sans pull Express avant présence close (livreur)'),
  ('auto_warn_risk',              '50',    'Risk score déclenchant un avertissement automatique'),
  ('auto_limit_risk',             '70',    'Risk score déclenchant une limitation automatique'),
  ('auto_suspend_risk',           '90',    'Risk score de recommandation de suspension'),
  ('auto_suspend_enabled',        'false', 'Suspension AUTOMATIQUE (sinon simple recommandation critique)'),
  ('sweep_min_interval_s',        '60',    'Intervalle minimal entre deux passes du sweep (s)'),
  ('learning_weight_min',         '0.2',   'Plancher du multiplicateur de poids appris'),
  ('learning_weight_max',         '1.5',   'Plafond du multiplicateur de poids appris'),
  ('near_dest_default_m',         '350',   'Distance (m) « proche de la destination » par défaut')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10) Catalogue de règles (seeds). params : fenêtres/seuils modifiables en UI.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.fraud_rules
  (code, actor_kind, category, label, description, base_weight, params, severity) VALUES

  -- CLIENTS ------------------------------------------------------------------
  ('CST_CANCEL_RATE', 'customer', 'annulation',
   'Taux d''annulation excessif',
   'Part des commandes + courses annulées par le client sur la fenêtre.',
   15, '{"window_days":30,"min_events":5,"ratio":0.30}', 'medium'),
  ('CST_CANCEL_AFTER_ACCEPT', 'customer', 'annulation',
   'Annulations après acceptation',
   'Annule alors qu''un partenaire a déjà accepté / s''est déplacé.',
   20, '{"window_days":30,"min_count":3}', 'medium'),
  ('CST_CANCEL_NEAR_DEST', 'customer', 'annulation',
   'Annulation près de la destination',
   'Course/livraison annulée alors que le partenaire est à moins de near_m de la destination — forte suspicion de finalisation hors plateforme.',
   30, '{"window_days":90,"near_m":350,"min_count":2}', 'high'),
  ('CST_CONTACT_THEN_CANCEL', 'customer', 'contact',
   'Annulation après appel/message',
   'Annule dans les minutes qui suivent un appel ou message du partenaire — schéma « annule, on s''arrange ». Compte comme situation suspecte (popup).',
   25, '{"window_days":90,"minutes":15,"min_count":2}', 'high'),
  ('CST_NOSHOW', 'customer', 'plainte',
   'No-show répétés',
   'No-shows validés par le support (customers.noshow_count).',
   20, '{"min_count":2}', 'medium'),
  ('CST_MULTI_ACCOUNT', 'customer', 'multi_compte',
   'Multi-comptes (IP/appareil partagés)',
   'Son IP/appareil récent est partagé par min_accounts comptes distincts.',
   20, '{"window_days":30,"min_accounts":3}', 'high'),
  ('CST_REFUND_ABUSE', 'customer', 'annulation',
   'Abus de remboursements',
   'Remboursements admin répétés sur la fenêtre.',
   15, '{"window_days":90,"min_count":3}', 'medium'),

  -- LIVREURS -----------------------------------------------------------------
  ('DRV_DECLINE_RATE', 'driver', 'refus',
   'Refus Express excessifs',
   'Part de refus parmi les décisions Express (bénéfice du doute sous min_decisions).',
   15, '{"window_days":7,"min_decisions":8,"ratio":0.60}', 'medium'),
  ('DRV_OFFER_IGNORED', 'driver', 'refus',
   'Offres ignorées (non-réponses)',
   'Offres vues sans acceptation ni refus sur la fenêtre.',
   12, '{"window_days":7,"min_count":6}', 'low'),
  ('DRV_CANCEL_AFTER_PICKUP', 'driver', 'annulation',
   'Abandon après récupération',
   'Course abandonnée/annulée APRÈS le pickup chez le commerçant.',
   30, '{"window_days":30,"min_count":1}', 'high'),
  ('DRV_CANCEL_NEAR_DEST', 'driver', 'annulation',
   'Annulation près de la destination',
   'Position du livreur à l''annulation < near_m de l''adresse de livraison — suspicion de livraison hors plateforme.',
   35, '{"window_days":90,"near_m":350,"min_count":1}', 'critical'),
  ('DRV_CONTACT_THEN_CANCEL', 'driver', 'contact',
   'Le client annule après son contact',
   'Le client annule ≤ minutes après un appel/message du livreur — suspicion de demande d''annulation.',
   30, '{"window_days":90,"minutes":15,"min_count":2}', 'high'),
  ('DRV_IDLE_ONLINE', 'driver', 'presence',
   'En ligne sans activité réelle',
   'Longues présences sans mouvement ni décision.',
   8, '{"window_days":7,"min_hours":4}', 'low'),
  ('DRV_MULTI_ACCOUNT', 'driver', 'multi_compte',
   'Multi-comptes partenaires',
   'IP/appareil partagé avec d''autres comptes partenaires.',
   20, '{"window_days":30,"min_accounts":2}', 'high'),
  ('DRV_COMPLAINTS', 'driver', 'plainte',
   'Signalements clients',
   'Signalements livraison ouverts/valides le visant.',
   20, '{"window_days":90,"min_count":2}', 'medium'),

  -- CHAUFFEURS ---------------------------------------------------------------
  ('CHF_CANCEL_AFTER_ACCEPT', 'chauffeur', 'annulation',
   'Annulations après acceptation',
   'Part des courses acceptées puis annulées par le chauffeur.',
   20, '{"window_days":30,"min_rides":5,"ratio":0.25}', 'medium'),
  ('CHF_CANCEL_AFTER_MOVE', 'chauffeur', 'annulation',
   'Annulation après déplacement',
   'Annule après être arrivé au point de départ, ou > move_min minutes après acceptation.',
   25, '{"window_days":30,"min_count":2,"move_min":4}', 'high'),
  ('CHF_CANCEL_NEAR_DEST', 'chauffeur', 'annulation',
   'Annulation près de la destination',
   'Position du chauffeur à l''annulation < near_m de la destination — suspicion de course finie hors plateforme (contournement de commission).',
   35, '{"window_days":90,"near_m":400,"min_count":1}', 'critical'),
  ('CHF_CONTACT_THEN_CANCEL', 'chauffeur', 'contact',
   'Le client annule après son contact',
   'Le client annule ≤ minutes après un appel/message du chauffeur — suspicion de demande d''annulation.',
   30, '{"window_days":90,"minutes":15,"min_count":2}', 'high'),
  ('CHF_COMPLAINTS', 'chauffeur', 'plainte',
   'Signalements clients',
   'Signalements de course le visant.',
   20, '{"window_days":90,"min_count":2}', 'medium'),
  ('CHF_GHOST_ONLINE', 'chauffeur', 'presence',
   'Fantôme en ligne',
   'Beaucoup d''heures en ligne, aucune offre envoyée.',
   8, '{"window_days":7,"min_hours":6}', 'low'),
  ('CHF_MULTI_ACCOUNT', 'chauffeur', 'multi_compte',
   'Multi-comptes partenaires',
   'IP/appareil partagé avec d''autres comptes partenaires.',
   20, '{"window_days":30,"min_accounts":2}', 'high'),

  -- COMMERÇANTS --------------------------------------------------------------
  ('MRC_REJECT_RATE', 'merchant', 'refus',
   'Annulations commerçant excessives',
   'Part des commandes annulées par le commerçant.',
   15, '{"window_days":30,"min_orders":5,"ratio":0.25}', 'medium'),
  ('MRC_CANCEL_AFTER_ACCEPT', 'merchant', 'annulation',
   'Faux préparatifs',
   'Annule après avoir accepté / commencé la préparation.',
   20, '{"window_days":30,"min_count":3}', 'medium'),
  ('MRC_CONTACT_THEN_CANCEL', 'merchant', 'contact',
   'Le client annule après son contact',
   'Le client annule ≤ minutes après un message du commerçant — suspicion de vente hors plateforme.',
   30, '{"window_days":90,"minutes":15,"min_count":2}', 'high'),
  ('MRC_SLOW_RESPONSE', 'merchant', 'anomalie',
   'Réactivité anormale',
   'Temps d''acceptation moyen anormalement haut vs les pairs.',
   8, '{"window_days":30,"min_orders":5}', 'low'),

  -- TRANSVERSES --------------------------------------------------------------
  ('COL_REPEAT_PAIR', 'all', 'collusion',
   'Collusion — paire récidiviste',
   'La même paire client × partenaire cumule des annulations suspectes (near-dest / post-contact) — fraude organisée.',
   30, '{"window_days":90,"min_count":2}', 'critical'),
  ('ANO_PEER_OUTLIER', 'all', 'anomalie',
   'Anomalie vs pairs (z-score)',
   'Métrique clé à plus de z écarts-types de la population des pairs.',
   10, '{"z":2.5}', 'low')
ON CONFLICT (code) DO NOTHING;

-- touch updated_at
CREATE OR REPLACE FUNCTION public.fraud_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS fraud_scores_touch ON public.fraud_scores;
CREATE TRIGGER fraud_scores_touch BEFORE UPDATE ON public.fraud_scores
  FOR EACH ROW EXECUTE FUNCTION public.fraud_touch_updated_at();
DROP TRIGGER IF EXISTS fraud_rules_touch ON public.fraud_rules;
CREATE TRIGGER fraud_rules_touch BEFORE UPDATE ON public.fraud_rules
  FOR EACH ROW EXECUTE FUNCTION public.fraud_touch_updated_at();
DROP TRIGGER IF EXISTS fraud_settings_touch ON public.fraud_settings;
CREATE TRIGGER fraud_settings_touch BEFORE UPDATE ON public.fraud_settings
  FOR EACH ROW EXECUTE FUNCTION public.fraud_touch_updated_at();
DROP TRIGGER IF EXISTS fraud_presence_touch ON public.fraud_partner_presence;
CREATE TRIGGER fraud_presence_touch BEFORE UPDATE ON public.fraud_partner_presence
  FOR EACH ROW EXECUTE FUNCTION public.fraud_touch_updated_at();
