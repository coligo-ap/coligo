-- =============================================================================
-- 0297 — Index sur les FK chaudes (préparation à la montée en charge)
-- =============================================================================
-- Audit d'index (01/07) : en prod les tables sont encore petites → les seq scans
-- sont OPTIMAUX aujourd'hui (le planner les préfère sur < 1000 lignes). MAIS
-- plusieurs clés étrangères sur des tables de CROISSANCE (commandes, courses,
-- rachats de promo, sous-paiements…) n'ont AUCUN index couvrant → dès que ces
-- tables grossiront, les filtres/jointures `.eq(<fk>)` deviendront des seq scans
-- coûteux. On ajoute donc PRÉVENTIVEMENT les index sur les FK réellement filtrées
-- par le code. Coût d'écriture négligeable ; IF NOT EXISTS = idempotent.
--
-- Non retenus volontairement : les FK vers auth.users (created_by), les tables
-- de config/overrides, et les directions de lookup jamais utilisées — un index
-- inutile ne fait qu'alourdir les écritures.
-- =============================================================================

-- orders : requêtes livreur (accueil « courses du jour », historique) filtrent
-- par delivery_driver_id et trient par created_at desc.
CREATE INDEX IF NOT EXISTS idx_orders_delivery_driver
  ON public.orders (delivery_driver_id, created_at DESC)
  WHERE delivery_driver_id IS NOT NULL;

-- orders : capacité par créneau (max_orders_per_slot) + vues tournée.
CREATE INDEX IF NOT EXISTS idx_orders_delivery_slot
  ON public.orders (delivery_slot_id)
  WHERE delivery_slot_id IS NOT NULL;

-- ride_offers : offres d'une course lues par chauffeur (dispatch / « mes offres »).
CREATE INDEX IF NOT EXISTS idx_ride_offers_chauffeur
  ON public.ride_offers (chauffeur_id);

-- ride_events : timeline d'une course (log append-only) lue par ride_id.
CREATE INDEX IF NOT EXISTS idx_ride_events_ride
  ON public.ride_events (ride_id);

-- chauffeur_subscription_payments : getChauffeurFinances filtre par chauffeur_id.
CREATE INDEX IF NOT EXISTS idx_chsub_payments_chauffeur
  ON public.chauffeur_subscription_payments (chauffeur_id);

-- promo : contrôle max_uses_per_customer au checkout (par client).
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_customer
  ON public.promotion_redemptions (customer_id);
CREATE INDEX IF NOT EXISTS idx_platform_promo_redemptions_customer
  ON public.platform_promotion_redemptions (customer_id);

-- customer_favorites : notifyCustomersPromo cible les clients ayant favorisé un
-- commerçant → lookup par merchant_id.
CREATE INDEX IF NOT EXISTS idx_customer_favorites_merchant
  ON public.customer_favorites (merchant_id);

-- delivery_ledger : lignes regroupées par relevé livreur.
CREATE INDEX IF NOT EXISTS idx_delivery_ledger_statement
  ON public.delivery_ledger (statement_id)
  WHERE statement_id IS NOT NULL;

-- tour_stops : arrêts d'une tournée reliés à leur commande.
CREATE INDEX IF NOT EXISTS idx_tour_stops_order
  ON public.tour_stops (order_id);
