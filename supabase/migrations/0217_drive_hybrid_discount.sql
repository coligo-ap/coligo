-- ============================================================================
-- 0217 — Remise HYBRIDE (partage du headroom client / chauffeur)
-- ----------------------------------------------------------------------------
-- La remise n'est plus « 20% − commission » brut : on PARTAGE le headroom
-- (market_take − commission) entre le client (remise) et le chauffeur (bonus
-- vs Yassir). Quand la commission monte (0→5→8→10→12%…), le headroom rétrécit,
-- donc la remise diminue EN DOUCEUR mais reste >= undercut_min (toujours sous
-- Yassir), tout en laissant un bonus chauffeur le plus longtemps possible.
--
--   headroom = market_take − commission_chauffeur
--   remise   = clamp( client_share × headroom , undercut_min , undercut_max )
--
-- Avec client_share=0.6, market_take=0.20, min 5%, max 12% :
--   commission 0%  → remise 12% | chauffeur ~+10% vs Yassir
--   commission 5%  → remise  9% | chauffeur ~+8%
--   commission 8%  → remise  7% | chauffeur ~+7%
--   commission 10% → remise  6% | chauffeur ~+6%
--   commission 12% → remise  5% | chauffeur ~+4%
--   commission 15% → remise  5% | chauffeur ~+1%
-- → client TOUJOURS sous Yassir ; chauffeur au-dessus de Yassir jusqu'à ~15%.
-- ============================================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS drive_client_share NUMERIC NOT NULL DEFAULT 0.60; -- part du headroom rendue au client

UPDATE public.platform_settings
  SET drive_undercut_min = 0.05,   -- plancher : toujours >= 5% sous Yassir
      drive_undercut_max = 0.12,   -- plafond : protège le chauffeur
      drive_client_share = 0.60
  WHERE id = true;

CREATE OR REPLACE FUNCTION public.drive_competitive_discount()
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT LEAST(s.drive_undercut_max, GREATEST(s.drive_undercut_min,
           s.drive_client_share * (s.drive_market_take - COALESCE(s.driver_fee_rate, 0))))
  FROM public.platform_settings s WHERE s.id = true;
$$;
GRANT EXECUTE ON FUNCTION public.drive_competitive_discount() TO authenticated, anon;
