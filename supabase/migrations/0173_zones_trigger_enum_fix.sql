-- =============================================================================
-- 0173 — CORRECTIF CRITIQUE : trigger zone orders + verrouillage stats
-- =============================================================================
-- BUG CRITIQUE (introduit en 0169, détecté par scripts/test-zones.mjs) :
--   orders.delivery_mode est un ENUM (`delivery_mode`), pas du `text`. Le trigger
--   enforce_order_service_zone appelait evaluate_service_zone(NEW.delivery_mode,…)
--   → la résolution de fonction échouait (« function … (delivery_mode, …) does
--   not exist ») → TOUTE création de commande livraison express/tour par un
--   client (rôle authenticated) ÉCHOUAIT. (L'admin/service_role n'était pas
--   touché car le trigger les court-circuite — ce qui masquait la régression.)
--   CORRECTIF : caster NEW.delivery_mode::text à l'appel.
--
-- SÉCURITÉ : Supabase accorde EXECUTE aux rôles anon/authenticated par DÉFAUT
--   (pas seulement via PUBLIC). Le REVOKE … FROM PUBLIC de 0172 ne suffisait
--   donc pas : zone_block_stats / zone_waitlist_stats restaient appelables par
--   tout utilisateur. On REVOKE explicitement FROM anon, authenticated.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_order_service_zone()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v RECORD;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF NEW.fulfillment_type::text IS DISTINCT FROM 'delivery' THEN RETURN NEW; END IF;
  IF NEW.delivery_mode::text NOT IN ('express', 'tour') THEN RETURN NEW; END IF;
  IF NEW.delivery_lat IS NULL OR NEW.delivery_lng IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v FROM public.evaluate_service_zone(
    NEW.delivery_mode::text, NEW.delivery_lat, NEW.delivery_lng,
    NEW.delivery_wilaya_code, NEW.delivery_commune, 'destination');

  IF NOT v.allowed THEN
    RAISE EXCEPTION 'service_zone_blocked:%', COALESCE(v.reason, 'blocked')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Verrouillage réel des stats ops (réservé service_role / admin).
REVOKE EXECUTE ON FUNCTION public.zone_block_stats(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.zone_waitlist_stats(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zone_block_stats(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.zone_waitlist_stats(INTEGER) TO service_role;

-- =============================================================================
-- VÉRIF : node scripts/test-zones.mjs
-- =============================================================================
