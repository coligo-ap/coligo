-- =============================================================================
-- 0101 — Frais de service : nouveau barème 40 / 30 / 20 DA
-- =============================================================================
-- Les frais de service (payés par le CLIENT, 100 % plateforme) restent
-- DÉGRESSIFS par paliers, mais les montants passent de 30/20/10 à 40/30/20 :
--   produits < 200 DA   → 40 DA
--   produits < 500 DA   → 30 DA
--   produits < 1000 DA  → 20 DA
--   produits ≥ 1000 DA  → 0 DA (gratuit, gros paniers)
--
-- La logique (compute_service_fee_da) est inchangée : on ne touche QUE la valeur
-- des paliers dans platform_settings (+ le DEFAULT de la colonne). Le frais est
-- snapshotté par commande à la création → les commandes existantes ne bougent
-- pas, seul l'avenir applique le nouveau barème.
-- =============================================================================

ALTER TABLE public.platform_settings
  ALTER COLUMN service_fee_tiers SET DEFAULT
    '[{"up_to": 200, "fee": 40}, {"up_to": 500, "fee": 30}, {"up_to": 1000, "fee": 20}]'::jsonb;

UPDATE public.platform_settings
  SET service_fee_tiers =
    '[{"up_to": 200, "fee": 40}, {"up_to": 500, "fee": 30}, {"up_to": 1000, "fee": 20}]'::jsonb
  WHERE id = true;

-- VÉRIF :
--   SELECT public.compute_service_fee_da(150);   -- → 40
--   SELECT public.compute_service_fee_da(300);   -- → 30
--   SELECT public.compute_service_fee_da(700);   -- → 20
--   SELECT public.compute_service_fee_da(1200);  -- → 0
