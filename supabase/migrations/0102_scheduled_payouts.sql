-- =============================================================================
-- 0102 — Versements PROGRAMMÉS au commerçant (auto hebdo / mensuel)
-- =============================================================================
-- En plus du versement « à la demande » existant, le commerçant peut activer un
-- versement AUTOMATIQUE de son solde disponible (façon Yassir : l'argent part
-- périodiquement, sans avoir à le demander). On ne déplace AUCUN argent ici :
-- la fonction crée une `payout_request` (status 'pending') que l'admin exécute
-- ensuite (virement CCP/RIB réel) — donc 100 % réversible et sûr.
--
-- Réglage par commerçant :
--   payout_auto    : 'none' (défaut) | 'weekly' | 'monthly'
--   payout_method  : méthode par défaut (ccp / rib / baridimob…)
--   payout_details : coordonnées (n° CCP / RIB) — requis pour l'auto
--   last_auto_payout_at : horodatage du dernier versement auto (anti-doublon)
-- =============================================================================

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS payout_auto TEXT NOT NULL DEFAULT 'none'
    CHECK (payout_auto IN ('none', 'weekly', 'monthly')),
  ADD COLUMN IF NOT EXISTS payout_method TEXT,
  ADD COLUMN IF NOT EXISTS payout_details TEXT,
  ADD COLUMN IF NOT EXISTS last_auto_payout_at TIMESTAMPTZ;

-- Génère les versements automatiques dus. Appelée par le cron (service_role).
-- Idempotente dans la fenêtre : un commerçant déjà versé cette semaine/ce mois
-- est ignoré tant que la période n'est pas écoulée.
CREATE OR REPLACE FUNCTION public.generate_scheduled_payouts(
  p_min_da INTEGER DEFAULT 1000
) RETURNS TABLE(created INTEGER, total_da INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  m          RECORD;
  v_balance  INTEGER;
  v_reserved INTEGER;
  v_avail    INTEGER;
  v_count    INTEGER := 0;
  v_sum      INTEGER := 0;
  v_due      BOOLEAN;
BEGIN
  FOR m IN
    SELECT id, payout_auto, payout_method, payout_details, last_auto_payout_at
    FROM public.merchants
    WHERE payout_auto IN ('weekly', 'monthly')
      AND COALESCE(is_frozen, false) = false
      AND payout_method IS NOT NULL
      AND btrim(COALESCE(payout_details, '')) <> ''
  LOOP
    -- Fenêtre échue ?
    v_due := m.last_auto_payout_at IS NULL
      OR (m.payout_auto = 'weekly'  AND m.last_auto_payout_at <= now() - interval '7 days')
      OR (m.payout_auto = 'monthly' AND m.last_auto_payout_at <= now() - interval '30 days');
    IF NOT v_due THEN CONTINUE; END IF;

    -- Disponible = solde wallet − demandes déjà en cours (pending/approved).
    SELECT COALESCE(sum(amount_da), 0) INTO v_balance
      FROM public.wallet_entries WHERE merchant_id = m.id;
    SELECT COALESCE(sum(amount_da), 0) INTO v_reserved
      FROM public.payout_requests
      WHERE merchant_id = m.id AND status IN ('pending', 'approved');
    v_avail := v_balance - v_reserved;

    IF v_avail < p_min_da THEN CONTINUE; END IF;

    INSERT INTO public.payout_requests (merchant_id, amount_da, status, method, details)
    VALUES (m.id, v_avail, 'pending', m.payout_method, m.payout_details);

    UPDATE public.merchants SET last_auto_payout_at = now() WHERE id = m.id;
    v_count := v_count + 1;
    v_sum   := v_sum + v_avail;
  END LOOP;

  created := v_count; total_da := v_sum; RETURN NEXT;
END;
$$;

-- Réservé au cron serveur (service_role) — jamais appelable par un client.
REVOKE ALL ON FUNCTION public.generate_scheduled_payouts(INTEGER) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_scheduled_payouts(INTEGER) TO service_role;
