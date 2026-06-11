-- ============================================================
-- 0151 — Coligo Drive : tarification plus compétitive sur les
-- petits trajets urbains (vs Indrive) + recalibrage distance.
--
-- Contexte : le client calcule désormais la distance ROUTIÈRE
-- réelle (OSRM) au lieu du vol d'oiseau (≈ +25 %). Le per_km est
-- donc recalibré à la baisse, et base/min sont réduits pour que
-- les courses courtes passent clairement sous les 250 DA :
--   • classic : base 150→100, per_km 45→35, min 250→200
--   • confort : base 200→150, per_km 60→48, min 350→300
--   • moto    : base 100→80,  per_km 30→25, min 150→120
-- Exemples classic (distance routière, hors pointe/surge) :
--   2,5 km → 200 DA · 3,5 km → ~205 DA (Indrive ≈ 250) ·
--   6 km → ~285 DA · 15 km → ~575 DA.
-- Le plancher silencieux (drive_floor_rate) et le devis intelligent
-- (mig 0149) s'appuient sur ces mêmes valeurs : rien d'autre à changer.
-- ============================================================

UPDATE public.platform_settings
SET drive_pricing = jsonb_build_object(
  'classic', jsonb_build_object('base', 100, 'per_km', 35, 'min', 200),
  'confort', jsonb_build_object('base', 150, 'per_km', 48, 'min', 300),
  'moto',    jsonb_build_object('base',  80, 'per_km', 25, 'min', 120)
)
WHERE id = true;
