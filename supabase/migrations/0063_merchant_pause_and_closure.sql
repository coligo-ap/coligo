-- =============================================================================
-- 0063 — Pause temporaire & fermeture programmée du commerçant
-- =============================================================================
-- Complète `orders_paused` (fermeture indéfinie « jusqu'à réouverture ») :
--
--  * paused_until : pause TEMPORAIRE à réouverture automatique (Pause 30 min /
--    1 h / 2 h, ou « Fermer aujourd'hui » = jusqu'à la fin de journée). Quand
--    paused_until > now(), le commerce est considéré fermé ; passé ce moment,
--    il rouvre tout seul, sans cron (le checkout compare à now()).
--
--  * closure_start / closure_end : fermeture PROGRAMMÉE sur une plage de dates
--    (congés, travaux…). Le commerce est fermé tant que now() ∈ [start, end].
--
-- Le checkout (app/(customer)/checkout/actions.ts) refuse une commande
-- « immédiate » si l'un de ces verrous est actif ; les commandes PROGRAMMÉES
-- (créneau futur) restent possibles si le créneau tombe hors fermeture.
-- =============================================================================

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS paused_until  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closure_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closure_end   TIMESTAMPTZ;

COMMENT ON COLUMN public.merchants.paused_until IS
  'Pause temporaire : commerce fermé jusqu''à cette date/heure, puis réouverture auto.';
COMMENT ON COLUMN public.merchants.closure_start IS
  'Début de fermeture programmée (congés/travaux). NULL = pas de fermeture programmée.';
COMMENT ON COLUMN public.merchants.closure_end IS
  'Fin de fermeture programmée. Le commerce est fermé tant que now() est dans [start, end].';

-- Réexpose la vue publique avec les nouvelles colonnes (consommées côté client
-- pour bloquer/guider le checkout et afficher l'état « fermé »).
CREATE OR REPLACE VIEW public.merchants_public AS
  SELECT
    id, slug, name, category, description_fr, description_ar,
    logo_url, cover_url, phone_public, city, commune, wilaya_code,
    address, latitude, longitude, opening_hours, min_order_da, prep_time_min,
    accepts_cash, accepts_online, pickup_slot_minutes, max_orders_per_slot,
    is_active, created_at, max_days_ahead, rating_avg, rating_count,
    delivery_enabled, express_enabled, tours_enabled, delivery_radius_km,
    shop_public_id,
    orders_paused, paused_until, closure_start, closure_end
  FROM public.merchants
  WHERE is_active = true;
