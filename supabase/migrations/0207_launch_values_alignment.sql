-- =============================================================================
-- 0207 — ch.8 SPEC-COLIGO-PAY : alignement des VALEURS DE LANCEMENT
-- =============================================================================
-- Environnement de test (pas encore lancé en public) — alignement direct sur la
-- spec, valeurs de lancement :
--
--   • vtc_commission_rate          0.08 → 0.00  (Drive = acquisition chauffeurs ;
--                                                 « tout est à toi » au lancement)
--   • drive_cashback_rate          0.02 → 0.00  (pas de cashback Drive au lancement)
--   • tour_delivery_commission_rate 0.08 → 0.04 (outil tournée seul, pas le dispatch)
--   • cashback_cash                0.02 → 0.03  (taux cashback marketplace UNIQUE à
--                                                 3 % cash comme online ; sinon
--                                                 l'exemple 1 express COD ≠ 39 DA)
--   • drive_plan_pro_fee_da        2000 → 1500  (prix abo Pro retenu = 1500)
--
-- INCHANGÉS (déjà conformes) : commission_cash/online 0.08, driver_fee_rate 0.08,
-- cashback_online 0.03, service_fee_tiers (frais de service marketplace 40/30/20
-- ACTIF — exemple 1 garde ses 50 DA). Drive n'a pas de clé « frais de service »
-- (le client paie le chauffeur en direct) → déjà 0.
--
-- Règle ch.8 : frais de service et cashback s'activent ENSEMBLE. Au lancement
-- Drive = 0 commission / 0 frais service / 0 cashback (gratuit, acquisition).
-- =============================================================================

UPDATE public.platform_settings
SET vtc_commission_rate           = 0.00,
    drive_cashback_rate           = 0.00,
    tour_delivery_commission_rate = 0.04,
    cashback_cash                 = 0.03,
    drive_plan_pro_fee_da         = 1500,
    updated_at                    = now()
WHERE id = true;
