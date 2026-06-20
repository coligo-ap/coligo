-- 0231 — Convergence d'auto-calibrage plus rapide (step 0,10 → 0,18/jour).
-- La boucle corrige la dérive « trop bas » en ~10 jours au lieu de ~22.
UPDATE public.platform_settings SET drive_learn_step = 0.18 WHERE id = true;
