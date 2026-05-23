-- =============================================================================
-- Coligo v3 - Migration 0012 : Audit des changements de taux plateforme
-- =============================================================================
-- Appliquée via `npm run db:push` (ou copiable dans le SQL Editor Supabase).
--
-- ⚠️ ARGENT RÉEL — historique d'audit. Complète 0010 :
--   - Chaque modification de `platform_settings` est consignée AVANT/APRÈS.
--   - Permet d'expliquer pourquoi une commande passée affiche un taux différent
--     du taux courant (cf. snapshot, principe 2 de PROMPT 8 PARTIE A).
--   - Append-only, lecture super-admin uniquement. Insertion via trigger
--     SECURITY DEFINER (jamais d'écriture directe par le client).
-- =============================================================================

-- ============================================================================
-- 1. TABLE: platform_settings_history (audit append-only)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.platform_settings_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by  UUID,                       -- auth.uid() au moment du change
  changed_by_email TEXT,                  -- snapshot, robuste à suppression user
  before_data JSONB NOT NULL,
  after_data  JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_platform_settings_history_changed_at
  ON public.platform_settings_history(changed_at DESC);

-- ============================================================================
-- 2. Trigger: log BEFORE/AFTER à chaque UPDATE de platform_settings
-- ============================================================================
CREATE OR REPLACE FUNCTION public.log_platform_settings_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before JSONB;
  v_after  JSONB;
BEGIN
  v_before := to_jsonb(OLD) - 'updated_at';
  v_after  := to_jsonb(NEW) - 'updated_at';
  -- Pas de log si rien n'a changé (UPDATE no-op).
  IF v_before = v_after THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.platform_settings_history
    (changed_by, changed_by_email, before_data, after_data)
  VALUES
    (auth.uid(), (auth.jwt() ->> 'email'), v_before, v_after);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_log_platform_settings_change ON public.platform_settings;
CREATE TRIGGER trigger_log_platform_settings_change
  AFTER UPDATE ON public.platform_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.log_platform_settings_change();

-- ============================================================================
-- 3. ROW LEVEL SECURITY — lecture super-admin uniquement
-- ============================================================================
ALTER TABLE public.platform_settings_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_settings_history_select_admin"
  ON public.platform_settings_history
  FOR SELECT USING (public.is_super_admin());

-- =============================================================================
-- REQUÊTE DE VÉRIFICATION (à exécuter après, dans le SQL Editor) :
--
--   -- Avant : aucun changement
--   SELECT count(*) FROM public.platform_settings_history;
--
--   -- Provoquer un UPDATE (super-admin requis) :
--   UPDATE public.platform_settings SET commission_cash = 0.09 WHERE id = true;
--
--   -- Après : 1 ligne d'audit
--   SELECT changed_at, changed_by_email,
--          before_data->'commission_cash' AS before_cash,
--          after_data->'commission_cash'  AS after_cash
--   FROM public.platform_settings_history
--   ORDER BY changed_at DESC LIMIT 5;
-- =============================================================================
