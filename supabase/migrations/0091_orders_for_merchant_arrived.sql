-- =============================================================================
-- 0091 — orders_for_merchant : exposer delivery_arrived_at
-- =============================================================================
-- Le commerçant doit pouvoir afficher la PHASE réelle d'une livraison
-- (livreur en route → récupérée → livreur arrivé → livrée) plutôt que de rester
-- bloqué sur « Prête » pendant que le livreur est déjà en route / a récupéré /
-- a livré. La phase se déduit des horodatages livraison ; il manquait
-- `delivery_arrived_at` dans la vue. On recrée la vue à l'identique de 0041 en
-- ajoutant cette colonne. pickup_code reste masqué pour les livraisons.
-- =============================================================================

CREATE OR REPLACE VIEW public.orders_for_merchant AS
SELECT
  o.id, o.merchant_id, o.customer_id, o.customer_name, o.customer_phone,
  o.status, o.total_da, o.subtotal_da, o.discount_da, o.service_fee_da,
  o.cashback_da, o.cashback_estimate_da, o.cashback_used_da, o.topup_used_da,
  o.commission_da,
  CASE WHEN o.fulfillment_type = 'delivery' THEN NULL ELSE o.pickup_code END AS pickup_code,
  o.pickup_type, o.pickup_slot_at, o.pickup_slot_start, o.pickup_slot_end,
  o.customer_note, o.notes,
  o.payment_method, o.payment_status,
  o.fulfillment_type, o.delivery_mode,
  o.delivery_fee_da, o.delivery_address_text, o.delivery_lat, o.delivery_lng,
  o.delivery_phone, o.delivery_distance_km, o.delivery_driver_id,
  o.delivery_picked_up_at, o.delivery_delivered_at,
  o.delivery_slot_id, o.validated_without_code,
  o.created_at,
  -- Ajout 0091 — DOIT rester en dernier : CREATE OR REPLACE VIEW interdit de
  -- réordonner/renommer les colonnes existantes (n'autorise que des ajouts en fin).
  o.delivery_arrived_at
FROM public.orders o;
ALTER VIEW public.orders_for_merchant SET (security_invoker = true);
